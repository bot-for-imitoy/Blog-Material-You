#!/usr/bin/env node
/**
 * passwd-reset.mjs — Offline admin-credential recovery.
 *
 * Passwords are stored as one-way verifiers (scrypt, or the legacy
 * AES-256-CBC/`EVP_BytesToKey` record), so a forgotten password can never be
 * read back out of `blog/data/admin.json` — only replaced. This script is the
 * explicit, offline way to do that, and deliberately replaces the environment
 * switch the rewrite briefly had (`BMY_ADMIN_RESET=1`): resetting credentials
 * should be a deliberate command you type, never a config value that can
 * quietly overwrite an account on some later restart.
 *
 * Usage:
 *   npm run passwd-reset                     Set a new password (interactive)
 *   npm run passwd-reset -- --clear          Clear the account so /admin/setup/ can run again
 *   npm run passwd-reset -- --password '…'   Non-interactive (also --user)
 *   npm run passwd-reset -- --clear --keep-totp
 *   npm run passwd-reset -- --help
 *
 * Inside Docker:
 *   docker compose exec blog npm run passwd-reset -- --clear
 *
 * The existing credential file is backed up next to itself (mode 0600) before
 * anything is changed, so a mistaken reset is recoverable.
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Import the application's own modules so the script writes exactly the format
// the server reads, honours BMY_BLOG_DIR / BMY_DATA_DIR, and shares one password
// policy with the setup API.
const credentials = await import(path.join(ROOT, 'src/store/credentials.ts'));
const totpState = await import(path.join(ROOT, 'src/store/totp-state.ts'));
const { MIN_PASSWORD_LENGTH, passwordProblem, usernameProblem } = await import(
  path.join(ROOT, 'src/auth/password.ts')
);

// ===================== argument parsing =====================

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);

/** Read `--key value` or `--key=value`. */
function option(name, fallback = null) {
  const withEquals = argv.find((a) => a.startsWith(`--${name}=`));
  if (withEquals) return withEquals.slice(name.length + 3);
  const index = argv.indexOf(`--${name}`);
  if (index !== -1 && index + 1 < argv.length && !argv[index + 1].startsWith('--')) {
    return argv[index + 1];
  }
  return fallback;
}

const CLEAR = has('--clear');
const KEEP_TOTP = has('--keep-totp');
const ASSUME_YES = has('--yes') || has('-y');
const HELP = has('--help') || has('-h');
const USER_OPTION = option('user');
const PASSWORD_OPTION = option('password');

const CREDENTIALS_FILE = credentials.credentialsStore.file;
const TOTP_FILE = totpState.totpStore.file;

// ===================== output helpers =====================

const cyan = (s) => `\u001b[36m${s}\u001b[0m`;
const green = (s) => `\u001b[32m${s}\u001b[0m`;
const yellow = (s) => `\u001b[33m${s}\u001b[0m`;
const dim = (s) => `\u001b[2m${s}\u001b[0m`;
const bold = (s) => `\u001b[1m${s}\u001b[0m`;

function usage() {
  console.log(`
${bold('Blog Material You — 管理员密码重置')}

${cyan('用法')}
  npm run passwd-reset                    交互式设置新密码
  npm run passwd-reset -- --clear         清空管理员账号，回到未初始化状态
  npm run passwd-reset -- --password 'xxx' [--user admin]
  npm run passwd-reset -- --clear --keep-totp
  npm run passwd-reset -- --yes           跳过确认

${cyan('说明')}
  密码只以「单向校验值」形式保存（scrypt，或旧版的 AES-256-CBC 记录），
  无法读回原文，只能替换。因此忘记密码时用本脚本重置。

  --clear  会删除管理员账号，并${bold('默认同时关闭两步验证')}——否则新建的账号
           登录时仍会要求旧验证器上的动态码，导致依然进不去。
           用 --keep-totp 可以保留两步验证状态。

${cyan('路径')}
  凭据文件  ${CREDENTIALS_FILE}
  两步验证  ${TOTP_FILE}
  ${dim('（可用 BMY_BLOG_DIR / BMY_DATA_DIR 改变位置，Docker 内同理）')}

${cyan('Docker')}
  docker compose exec blog npm run passwd-reset -- --clear
`);
}

/** Ask a question on the terminal (visible input). */
function ask(question, defaultValue = '') {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const suffix = defaultValue ? dim(` (${defaultValue})`) : '';
    rl.question(`${question}${suffix} `, (answer) => {
      rl.close();
      resolve(answer.trim() === '' ? defaultValue : answer.trim());
    });
  });
}

/**
 * Ask for a secret without echoing it.
 * Falls back to a plain prompt when stdin is not a TTY (e.g. piped input).
 */
function askHidden(question) {
  const stdin = process.stdin;
  if (!stdin.isTTY) return ask(question);

  return new Promise((resolve, reject) => {
    process.stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let value = '';

    const finish = (fn, arg) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
      process.stdout.write('\n');
      fn(arg);
    };

    const onData = (char) => {
      if (char === '\n' || char === '\r' || char === '\u0004') return finish(resolve, value);
      if (char === '\u0003') return finish(reject, new Error('已取消')); // Ctrl-C
      if (char === '\u007f' || char === '\b') {
        if (value.length > 0) {
          value = value.slice(0, -1);
          process.stdout.write('\b \b');
        }
        return;
      }
      if (char >= ' ') {
        value += char;
        process.stdout.write('*');
      }
    };

    stdin.on('data', onData);
  });
}

/** Ask for confirmation unless --yes was passed. */
async function confirm(question) {
  if (ASSUME_YES) return true;
  if (!process.stdin.isTTY) return true; // non-interactive: --yes semantics
  const answer = await ask(`${question} ${dim('(yes/no)')}`);
  return ['y', 'yes', '是'].includes(answer.toLowerCase());
}

/** Copy the credential file aside before touching it. */
function backup(file) {
  if (!fs.existsSync(file)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = `${file}.bak-${stamp}`;
  fs.copyFileSync(file, target);
  try {
    fs.chmodSync(target, 0o600);
  } catch {
    /* best effort */
  }
  return target;
}

// ===================== main =====================

async function main() {
  if (HELP) {
    usage();
    return;
  }

  const configured = credentials.credentialFormat();
  console.log(`\n${bold('Blog Material You — 管理员凭据重置')}`);
  console.log(`  凭据文件        ${CREDENTIALS_FILE}`);
  console.log(`  当前状态        ${configured === 'none' ? '未初始化（无账号）' : configured === 'legacy' ? '旧版 AES 记录' : 'scrypt 记录'}`);
  if (configured !== 'none') console.log(`  当前用户名      ${credentials.getUser()}`);
  console.log(`  两步验证        ${totpState.isTotpEnabled() ? yellow('已启用') : '未启用'}`);
  console.log();

  // ---------- --clear ----------
  if (CLEAR) {
    if (configured === 'none') {
      console.log(green('管理员账号本来就未初始化，无需清空。'));
      console.log(`打开 ${cyan('/admin/setup/')} 即可创建。\n`);
      return;
    }

    const clearTotp = !KEEP_TOTP && totpState.isTotpEnabled();
    console.log(yellow('即将删除管理员账号：'));
    console.log(`  · 用户名            ${credentials.getUser()}`);
    console.log(`  · 密码              ${dim('（校验值会被删除，无法找回）')}`);
    console.log(`  · 两步验证          ${clearTotp ? '同时关闭' : totpState.isTotpEnabled() ? '保留' : '（未启用）'}`);
    console.log();

    if (!(await confirm('确认继续？'))) {
      console.log('已取消。\n');
      return;
    }

    const backupFile = backup(CREDENTIALS_FILE);
    credentials.clearCredentials();
    if (clearTotp) totpState.disable();

    console.log(`\n${green('✔ 已完成')}`);
    if (backupFile) console.log(`  旧凭据已备份到  ${dim(backupFile)}`);
    console.log(`  管理员账号      ${yellow('已清空')}`);
    if (clearTotp) console.log(`  两步验证        ${yellow('已关闭')}`);
    console.log(`\n下一步：\n  1. 启动服务        ${cyan('npm start')}`);
    console.log(`  2. 打开            ${cyan('/admin/setup/')}`);
    console.log(`  3. 设置新的管理员用户名与密码\n`);
    return;
  }

  // ---------- set a new password ----------
  let user = USER_OPTION ?? credentials.getUser() ?? '';
  let password = PASSWORD_OPTION ?? '';

  const interactive = process.stdin.isTTY && !PASSWORD_OPTION;

  if (interactive) {
    user = await ask('管理员用户名：', user || 'admin');

    const first = await askHidden(`新密码（至少 ${MIN_PASSWORD_LENGTH} 位）：`);
    const second = await askHidden('再输入一次：');
    if (first !== second) {
      console.error(`\n${yellow('两次输入不一致，未做任何修改。')}\n`);
      process.exitCode = 1;
      return;
    }
    password = first;
  }

  if (!password) {
    console.error(`${yellow('缺少密码。')} 请用交互方式运行，或传入 ${cyan("--password '…'")}。`);
    console.error(`查看用法：${cyan('npm run passwd-reset -- --help')}\n`);
    process.exitCode = 1;
    return;
  }

  const userError = usernameProblem(user);
  if (userError) {
    console.error(`\n${yellow(`用户名不合法：${userError}`)}\n`);
    process.exitCode = 1;
    return;
  }
  const passwordError = passwordProblem(password);
  if (passwordError) {
    console.error(`\n${yellow(`密码不合法：${passwordError}`)}\n`);
    process.exitCode = 1;
    return;
  }

  const existed = configured !== 'none';
  if (existed && !(await confirm(`确认把「${user}」的密码改为新密码？`))) {
    console.log('已取消。\n');
    return;
  }

  const backupFile = backup(CREDENTIALS_FILE);
  credentials.setCredentials(user, password);

  console.log(`\n${green('✔ 已完成')}`);
  if (backupFile) console.log(`  旧凭据已备份到  ${dim(backupFile)}`);
  console.log(`  用户名          ${user}`);
  console.log(`  密码            ${dim('（已写成 scrypt 校验值，仅本次可见，请自行保存）')}`);
  if (totpState.isTotpEnabled()) {
    console.log(`  两步验证        ${yellow('仍处于启用状态——登录时还需要验证器上的动态码')}`);
  }
  console.log(`\n用新密码登录 ${cyan('/admin/login/')} 即可。\n`);
}

main().catch((err) => {
  console.error(`\n${yellow(`重置失败：${err.message}`)}\n`);
  process.exitCode = 1;
});
