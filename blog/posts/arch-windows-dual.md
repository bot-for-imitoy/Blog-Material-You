---
title: 在已经安装 Arch Linux 的电脑上再安装一个 Windows
date: 2025-08-07
tags: [Linux, Windows]
title_en: 
content_en: 
---

# [](<#背景> "背景")背景

前几天新电脑到货了，想都没想就直接装上了 Arch，后来发现 Linux 没有 GPU 共享内存？？（[Fk you NVIDIA](<https://cn.bing.com/search?q=fuck+you+nvidia>)）后来没办法，才又装了双系统。

# [](<#安装准备> "安装准备")安装准备

## [](<#需要准备的东西> "需要准备的东西")需要准备的东西

  * 足够的信心和耐心
  * 一个U盘
  * 一台电脑



## [](<#配置安装系统> "配置安装系统")配置安装系统

首先要[下载Arch Linux](<https://archlinux.org/download/>)和[下载Windows](<https://www.microsoft.com/zh-cn/software-download/windows11>)。

然后来制作安装盘，这里我选择 Ventoy。

先安装 Ventoy：
    
    
    1  
    

| 
    
    
    yay -S ventoy  
      
  
---|---  
  
然后按照提示制作安装盘。
    
    
    1  
    

| 
    
    
    ventoy -i /dev/sda  
      
  
---|---  
  
制作完成后把上面下载的两个文件复制到U盘里。不要忘记 umount。

_我就没 umount，然后就一直不能关机，显示有服务不能停止，等了两分钟就我强制关机了。结果开机选 Ventoy 里的文件的时候告诉我文件缺失，我算了 sha1sum，每次重启都不一样。期间我还以为U盘坏了，还换了个U盘。我突然想起来 Arch Wiki 中的[3.3 Q) 为什么 Arch Linux 把我的所有内存用光了？](<https://wiki.archlinuxcn.org/wiki/%E5%B8%B8%E8%A7%81%E9%97%AE%E9%A2%98>)，才想到我对硬盘做的改动是先写到内存里的，要不然 cp 复制的时候那么快就复制完了。好嘛，umount 用了十多分钟，U盘写入速度也是够慢的。这也解释了为什么不能关机了。_

之后进 BIOS，选择 Arch Linux 安装盘启动。

#### [](<#换源> "换源")换源
    
    
    1  
    2  
    3  
    

| 
    
    
    cd /etc/pacman.d/  
    rm mirrorlist  
    nano mirrorlist  
      
  
---|---  
  
然后输入 `Server = https://mirrors.aliyun.com/arch Linux/$repo/os/$arch` ，保存退出，然后输入
    
    
    1  
    

| 
    
    
    pacman -Sy  
      
  
---|---  
  
# [](<#分区> "分区")分区

分区前：

  * 1G EFI 分区
  * 1023G Linux File System，Btrfs 文件系统



其中 Linux File System 部分分为 `/` 子卷和 `/home` 子卷。

那就来规划一下怎么分吧：

  * 1G EFI 分区，引导系统加载（因为当初装 Arch Linux 的时候考虑过以后可能会装好几个系统，所以预留的比较大）
  * 672G Linux File System，Btrfs 文件系统
  * 128G Windows 系统分区
  * 128G Windows D盘



然后要**再回顾一下是否做好了重要文件备份，没有备份不能进行下一步！！！** （一般情况下不会有损失，备份重要文件即可）

主要思路：因为已经使用了 Btrfs 文件系统，所以可以先缩小 Btrfs 实际分区大小，然后再缩小 Btrfs 的物理分区。

查看当前分区情况：
    
    
    1  
    

| 
    
    
    lsblk  
      
  
---|---  
  
挂载：
    
    
    1  
    2  
    

| 
    
    
    mount -t btrfs -o subvol=/@,compress=zstd /dev/nvmexn1p2 /mnt # 挂载 / 目录  
    mount -t btrfs -o subvol=/@home,compress=zstd /dev/nvmexn1p2 /mnt/home --mkdir  
      
  
---|---  
  
缩小 Btrfs 分区：
    
    
    1  
    

| 
    
    
    btrfs filesystem resize -128G /mnt  
      
  
---|---  
  
这里写128是因为我一开始只分了128G，后来才发现128G可能不太够用，，又分了128G给D盘

卸载分区：
    
    
    1  
    

| 
    
    
    umount -R /mnt  
      
  
---|---  
  
然后来缩小物理分区：
    
    
    1  
    

| 
    
    
    parted /dev/nvmexn1p  
      
  
---|---  
  
在交互命令里，打印分区信息：
    
    
    1  
    

| 
    
    
    (parted) print  
      
  
---|---  
  
会看到类似的输出：
    
    
    1  
    2  
    3  
    

| 
    
    
    Number  Start   End     Size    File system  Name  Flags  
     1      0.07GB  1.07GB  1GB  fat32              boot, esp  
     2      1.07GB  1024GB   1023GB btrfs  
      
  
---|---  
  
缩小物理分区：
    
    
    1  
    

| 
    
    
    (parted) resizepart 2 807  
      
  
---|---  
  
这里的2代表分区编号（Number system），807代表 Btrfs 实际空间的**结束位置** ，这个数值需要靠计算获得。

原先的 Btrfs 分区大小为1023G，起始位置是1.07G，我们要划出去128G，那么 Btrfs 分区的大小就变为1023-128=895G。因为起始位置是1.07G，所以修改后分区结束位置为1.07+895=896.07G。

**因为实际上1.07是一个约数，所以为了不损坏数据，这里不能直接输入896.07G作为结束位置，而是要大于这个值。** 所以我直接输入897G作为结束位置。

退出：
    
    
    1  
    

| 
    
    
    (parted) quit  
      
  
---|---  
  
# [](<#安装> "安装")安装

重启，选择 Windows 引导盘进入，然后在界面中选择“以前的安装程序”。之后选择未分配的空间进行安装，安装程序会自己划分 Windows 的各种分区。

安装后，再次进入 BIOS，选择 Arch Linux 引导盘，来重新配置 grub。
    
    
    1  
    2  
    

| 
    
    
    sudo pacman -S os-prober #为了让 grub 能够识别 Windows  
    grub-install --target=x86_64-efi --efi-directory=/boot --bootloader-id=ArchLinux  
      
  
---|---  
  
接下来编辑 grub 文件：
    
    
    1  
    

| 
    
    
    vim /etc/default/grub  
      
  
---|---  
  
在 `GRUB ...` 下添加新的一行：
    
    
    1  
    

| 
    
    
    GRUB_DISABLE_OS_PROBER=false  
      
  
---|---  
  
保存退出，最后生成配置文件：
    
    
    1  
    

| 
    
    
    grub-mkconfig -o /boot/grub/grub.cfg  
      
  
---|---  
  
这样就安装好了，重启即可。

* * *

Submit

### Comments