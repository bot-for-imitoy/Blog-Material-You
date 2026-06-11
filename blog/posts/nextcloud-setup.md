---
title: Nextcloud + Nginx + Termux + FRP 搭建个人云盘
date: 2025-11-23
categories: [笔记]
title_en: 
content_en: 
---

# [](<#背景> "背景")背景

很久之前就想搭了，本来是用百度网盘，后来就不怎么用了（稍微想想就知道为什么不用了， **不过多赘述** ），后来改用阿里云盘了，然后就看见了阿里云盘泄漏隐私照片的新闻了。。（就非得让我看见吗？）

然后就不想用各大网盘了。

# [](<#准备> "准备")准备

Nameslio 一个域名，之前已经买好的。

域名对应的 SSL 证书。这个我是在服务器上使用 acme.sh 获取的，手机应该也可以（虽然我失败了，但是后来在服务器上成功了，就没怎么研究），到时候选 DNS 申请就行了

[下载 Nextcloud](<https://download.nextcloud.com/server/releases>)，在这里面找一个版本下载。因为我是 Arch Linux 用户，所以下载最新的 32.0.2.zip。（建议验证一下校验和）

配置好 Termux，包括换源之类的。然后安装 proot-distro，在里边安装 Ubuntu。（怕麻烦所以不用 Arch 了）
    
    
    1  
    2  
    3  
    4  
    5  
    

| 
    
    
    apt update && apt upgrade  
    apt install proot-distro  
    proot-distro install ubuntu  
    ln -sf /data/data/com.termux/files/usr/var/lib/proot-distro/installed-rootfs/ubuntu /data/data/com.termux/files/home/ubuntu  
    proot-distro login ubuntu --shared-tmp  
      
  
---|---  
  
然后需要把上边下载的压缩包放到 Termux 的文件夹里，然后解压。（假设现在已经是 proot 环境）
    
    
    1  
    

| 
    
    
    unzip /storage/emulated/0/Download/nextcloud-32.0.2.zip -d /var/www  
      
  
---|---  
  
在 proot 里更新一下：
    
    
    1  
    

| 
    
    
    apt update && apt upgrade  
      
  
---|---  
  
然后需要安装以下包：
    
    
    1  
    2  
    

| 
    
    
    apt install nginx php-gd php-mysql php-curl php-mbstring php-intl php-gmp php-bcmath php-xml php-imagick php-zip php-fpm mariadb-server  
    apt install vim tree # 这是我比较喜欢用的  
      
  
---|---  
  
# [](<#配置数据库> "配置数据库")配置数据库

现在是进不去数据库的，得稍微设置一下才行。如果不设置会报 `Access denied`

编辑 `/etc/mysql/my.cnf` （如果你不是 Ubuntu，名字差不多就行），在下面写入：
    
    
    1  
    2  
    

| 
    
    
    [server]  
    skip_grant_tables  
      
  
---|---  
  
现在可以了，在这个窗口运行 `mariadbd-safe` ，数据库服务器就运行起来了，接下来新开一个窗口执行下面的操作。

# [](<#配置-php> "配置 php")配置 php

因为 Nginx 要连接 php（可以理解为 Nextcloud 是由 php 写的），所以需要拿到 php 运行时候的 `sock` 文件。

先运行一下 `php-fpm8.4`，运行之后会出现一个文件： `www.conf`。这个文件位于 `pool.d` 中，完整路径是 `/etc/php/8.4/fpm/pool.d/www.conf` （不同发行版可能略有差异，官方文档上写红帽系貌似是 `/etc/php-fpm/...`）

打开这个 `www.conf` ，找到 `listen` 一行，后面就是 `sock` 文件的地址，把这个地址记住，一会要用。

好的，现在杀掉刚刚的 `php-fpm` 进程。

# [](<#配置-Nginx> "配置 Nginx")配置 Nginx

在 `/etc/nginx/sites-enabled` 文件夹下创建一个 `nextcloud.conf` ，写入下面的内容：（不用管是什么了，这是从官网文档上弄的）
    
    
    1  
    2  
    3  
    4  
    5  
    6  
    7  
    8  
    9  
    10  
    11  
    12  
    13  
    14  
    15  
    16  
    17  
    18  
    19  
    20  
    21  
    22  
    23  
    24  
    25  
    26  
    27  
    28  
    29  
    30  
    31  
    32  
    33  
    34  
    35  
    36  
    37  
    38  
    39  
    40  
    41  
    42  
    43  
    44  
    45  
    46  
    47  
    48  
    49  
    50  
    51  
    52  
    53  
    54  
    55  
    56  
    57  
    58  
    59  
    60  
    61  
    62  
    63  
    64  
    65  
    66  
    67  
    68  
    69  
    70  
    71  
    72  
    73  
    74  
    75  
    76  
    77  
    78  
    79  
    80  
    81  
    82  
    83  
    84  
    85  
    86  
    87  
    88  
    89  
    90  
    91  
    92  
    93  
    94  
    95  
    96  
    97  
    98  
    99  
    100  
    101  
    102  
    103  
    104  
    105  
    106  
    107  
    108  
    109  
    110  
    111  
    112  
    113  
    114  
    115  
    116  
    117  
    118  
    119  
    120  
    121  
    122  
    123  
    124  
    125  
    126  
    127  
    128  
    129  
    130  
    131  
    132  
    133  
    134  
    135  
    136  
    137  
    138  
    139  
    140  
    141  
    142  
    143  
    144  
    145  
    146  
    147  
    148  
    149  
    150  
    151  
    152  
    153  
    154  
    155  
    156  
    157  
    158  
    159  
    160  
    161  
    162  
    163  
    164  
    165  
    166  
    167  
    168  
    169  
    170  
    171  
    172  
    173  
    174  
    175  
    176  
    177  
    178  
    179  
    180  
    181  
    182  
    183  
    184  
    

| 
    
    
    upstream php-handler {  
        #server 127.0.0.1:9000;  
        server unix:/run/php/php8.4-fpm.sock; # 这行替换成上面让你记住的那个  
    }  
      
    # Set the `immutable` cache control options only for assets with a cache busting `v` argument  
    map $arg_v $asset_immutable {  
        "" "";  
        default "immutable";  
    }  
      
    server {  
        listen 8080; # 别忘了这里，手机没 root 不能开 1024 以下端口  
        listen [::]:8080;  
        server_name cloud.yourdomain.com; # 域名设置好  
      
        # Prevent nginx HTTP Server Detection  
        server_tokens off;  
      
        # Enforce HTTPS  
        return 301 https://$server_name$request_uri;  
    }  
      
    server {  
        listen 8443      ssl http2;  
        listen [::]:8443 ssl http2;  
        server_name cloud.yourdomain.com;  
      
        # Path to the root of your installation  
        root /var/www/nextcloud; # 路径  
      
        # Use Mozilla's guidelines for SSL/TLS settings  
        # https://mozilla.github.io/server-side-tls/ssl-config-generator/  
        ssl_certificate     /etc/ssl/nginx/cloud.yourdomain.top_ecc/fullchain.cer;  
        ssl_certificate_key /etc/ssl/nginx/cloud.yourdomain.top_ecc/cloud.yourdomain.top.key;  
      
        # 下面的应该都不用管了  
      
        # Prevent nginx HTTP Server Detection  
        server_tokens off;  
      
        # HSTS settings  
        # WARNING: Only add the preload option once you read about  
        # the consequences in https://hstspreload.org/. This option  
        # will add the domain to a hardcoded list that is shipped  
        # in all major browsers and getting removed from this list  
        # could take several months.  
        #add_header Strict-Transport-Security "max-age=15768000; includeSubDomains; preload" always;  
      
        # set max upload size and increase upload timeout:  
        client_max_body_size 512M;  
        client_body_timeout 300s;  
        fastcgi_buffers 64 4K;  
      
        # Enable gzip but do not remove ETag headers  
        gzip on;  
        gzip_vary on;  
        gzip_comp_level 4;  
        gzip_min_length 256;  
        gzip_proxied expired no-cache no-store private no_last_modified no_etag auth;  
        gzip_types application/atom+xml application/javascript application/json application/ld+json application/manifest+json application/rss+xml application/vnd.geo+json application/vnd.ms-fontobject application/wasm application/x-font-ttf application/x-web-app-manifest+json application/xhtml+xml application/xml font/opentype image/bmp image/svg+xml image/x-icon text/cache-manifest text/css text/plain text/vcard text/vnd.rim.location.xloc text/vtt text/x-component text/x-cross-domain-policy;  
      
        # Pagespeed is not supported by Nextcloud, so if your server is built  
        # with the `ngx_pagespeed` module, uncomment this line to disable it.  
        #pagespeed off;  
      
        # The settings allows you to optimize the HTTP2 bandwitdth.  
        # See https://blog.cloudflare.com/delivering-http-2-upload-speed-improvements/  
        # for tunning hints  
        client_body_buffer_size 512k;  
      
        # HTTP response headers borrowed from Nextcloud `.htaccess`  
        add_header Referrer-Policy                      "no-referrer"   always;  
        add_header X-Content-Type-Options               "nosniff"       always;  
        add_header X-Download-Options                   "noopen"        always;  
        add_header X-Frame-Options                      "SAMEORIGIN"    always;  
        add_header X-Permitted-Cross-Domain-Policies    "none"          always;  
        add_header X-Robots-Tag                         "none"          always;  
        add_header X-XSS-Protection                     "1; mode=block" always;  
      
        # Remove X-Powered-By, which is an information leak  
        fastcgi_hide_header X-Powered-By;  
      
        # Specify how to handle directories -- specifying `/index.php$request_uri`  
        # here as the fallback means that Nginx always exhibits the desired behaviour  
        # when a client requests a path that corresponds to a directory that exists  
        # on the server. In particular, if that directory contains an index.php file,  
        # that file is correctly served; if it doesn't, then the request is passed to  
        # the front-end controller. This consistent behaviour means that we don't need  
        # to specify custom rules for certain paths (e.g. images and other assets,  
        # `/updater`, `/ocm-provider`, `/ocs-provider`), and thus  
        # `try_files $uri $uri/ /index.php$request_uri`  
        # always provides the desired behaviour.  
        index index.php index.html /index.php$request_uri;  
      
        # Rule borrowed from `.htaccess` to handle Microsoft DAV clients  
        location = / {  
            if ( $http_user_agent ~ ^DavClnt ) {  
                return 302 /remote.php/webdav/$is_args$args;  
            }  
        }  
      
        location = /robots.txt {  
            allow all;  
            log_not_found off;  
            access_log off;  
        }  
      
        # Make a regex exception for `/.well-known` so that clients can still  
        # access it despite the existence of the regex rule  
        # `location ~ /(\.|autotest|...)` which would otherwise handle requests  
        # for `/.well-known`.  
        location ^~ /.well-known {  
            # The rules in this block are an adaptation of the rules  
            # in `.htaccess` that concern `/.well-known`.  
      
            location = /.well-known/carddav { return 301 /remote.php/dav/; }  
            location = /.well-known/caldav  { return 301 /remote.php/dav/; }  
      
            location /.well-known/acme-challenge    { try_files $uri $uri/ =404; }  
            location /.well-known/pki-validation    { try_files $uri $uri/ =404; }  
      
            # Let Nextcloud's API for `/.well-known` URIs handle all other  
            # requests by passing them to the front-end controller.  
            return 301 /index.php$request_uri;  
        }  
      
        # Rules borrowed from `.htaccess` to hide certain paths from clients  
        location ~ ^/(?:build|tests|config|lib|3rdparty|templates|data)(?:$|/)  { return 404; }  
        location ~ ^/(?:\.|autotest|occ|issue|indie|db_|console)                { return 404; }  
      
        # Ensure this block, which passes PHP files to the PHP process, is above the blocks  
        # which handle static assets (as seen below). If this block is not declared first,  
        # then Nginx will encounter an infinite rewriting loop when it prepends `/index.php`  
        # to the URI, resulting in a HTTP 500 error response.  
        location ~ \.php(?:$|/) {  
            # Required for legacy support  
            rewrite ^/(?!index|remote|public|cron|core\/ajax\/update|status|ocs\/v[12]|updater\/.+|oc[ms]-provider\/.+|.+\/richdocumentscode\/proxy) /index.php$request_uri;  
      
            fastcgi_split_path_info ^(.+?\.php)(/.*)$;  
            set $path_info $fastcgi_path_info;  
      
            try_files $fastcgi_script_name =404;  
      
            include fastcgi_params;  
            fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;  
            fastcgi_param PATH_INFO $path_info;  
            fastcgi_param HTTPS on;  
      
            fastcgi_param modHeadersAvailable true;         # Avoid sending the security headers twice  
            fastcgi_param front_controller_active true;     # Enable pretty urls  
            fastcgi_pass php-handler;  
      
            fastcgi_intercept_errors on;  
            fastcgi_request_buffering off;  
      
            fastcgi_max_temp_file_size 0;  
        }  
      
        location ~ \.(?:css|js|svg|gif|png|jpg|ico|wasm|tflite|map)$ {  
            try_files $uri /index.php$request_uri;  
            add_header Cache-Control "public, max-age=15778463, $asset_immutable";  
            access_log off;     # Optional: Don't log access to assets  
      
            location ~ \.wasm$ {  
                default_type application/wasm;  
            }  
        }  
      
        location ~ \.woff2?$ {  
            try_files $uri /index.php$request_uri;  
            expires 7d;         # Cache-Control policy borrowed from `.htaccess`  
            access_log off;     # Optional: Don't log access to assets  
        }  
      
        # Rule borrowed from `.htaccess`  
        location /remote {  
            return 301 /remote.php$request_uri;  
        }  
      
        location / {  
            try_files $uri $uri/ /index.php$request_uri;  
        }  
    }  
      
  
---|---  
  
这里要注意的是第三行和 server 花括号里的前几行，填你的端口、链接等等。

这时候启动会报错，因为 `/etc/nginx/sites-enabled/default` 里面有个 80，把它改掉。这时候启动就没问题了。（两个 warn 暂时不用管）

# [](<#安装-Nextcloud> "安装 Nextcloud")安装 Nextcloud

访问 [https://127.0.0.1:8443](<https://127.0.0.1:8443/>) ，输入信息之后安装。如果提示不安全那么就无视风险

这期间可能会有一些卡顿，手机算力可能不太行，硬盘可能也不太行。

然后就可以在本地使用不安全的方式访问了。

# [](<#配置-FRP> "配置 FRP")配置 FRP

下载客户端，安装之后填好配置文件，启动

~~这步没啥可说的其实，一般服务商是支持 https 的~~

# [](<#Enjoy！> "Enjoy！")Enjoy！

* * *

Submit

### Comments