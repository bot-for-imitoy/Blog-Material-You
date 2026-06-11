---
title: 手机访问U盘
date: 2025-08-25
tags: [root, linux]
title_en: 
content_en: 
---

# [](<#背景> "背景")背景

我需要下载 Arch Linux ISO 到U盘里，由于电脑已经不能进入系统，只能使用 Arch Linux ISO 抢救，并且手机是 SSD 存储，所以为了不走手机 SSD，直接用命令行下载到U盘。（虽然小题大做了，但手机已经 root，无妨）

# [](<#准备> "准备")准备

  * 一台 root 的手机
  * Termux，确保能够访问 root
  * U盘
  * Type-C-OTG 转接头（图片来自网络）  
![Type-C-OTG转接头](https://res.imitoy.top/Qexo/26/3/1773392684.319837.webp)



# [](<#过程> "过程")过程

打开 Termux，先看都有哪些设备
    
    
    1  
    

| 
    
    
    sudo lsblk  
      
  
---|---  
  
结果如下：
    
    
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
    

| 
    
    
    NAME    MAJ:MIN RM   SIZE RO TYPE MOUNTPOINTS  
    loop0     7:0    0  35.9M  1 loop /bootstrap-apex/com.android.i18n  
                                      /bootstrap-apex/com.android.i18n@1  
    loop1     7:8    0   7.8M  1 loop /bootstrap-apex/com.android.runtime  
                                      /bootstrap-apex/com.android.runtime@1  
    loop2     7:16   0   836K  1 loop /bootstrap-apex/com.android.tzdata  
                                      /bootstrap-apex/com.android.tzdata@360526000  
    loop3     7:24   0  88.5M  1 loop /bootstrap-apex/com.android.virt  
                                      /bootstrap-apex/com.android.virt@3  
    loop4     7:32   0  10.3M  1 loop  
    loop5     7:40   0   6.8M  1 loop /apex/com.google.pixel.wifi.ext  
                                      /apex/com.google.pixel.wifi.ext@1  
    loop6     7:48   0   5.3M  1 loop /apex/com.google.android.widevine  
                                      /apex/com.google.android.widevine@190250226  
    loop7     7:56   0   264K  1 loop /apex/com.google.pixel.euicc.update  
                                      /apex/com.google.pixel.euicc.update@360499999  
    loop8     7:64   0   5.7M  1 loop  
    loop9     7:72   0   1.4M  1 loop  
    loop10    7:80   0    26M  1 loop  
    loop11    7:88   0   2.9M  1 loop  
    loop12    7:96   0   3.6M  1 loop /apex/com.android.compos  
                                      /apex/com.android.compos@3  
    loop13    7:104  0   652K  1 loop /apex/com.android.hardware.biometrics.fingerprint.virtual  
                                      /apex/com.android.hardware.biometrics.fingerprint.virtual@1  
    loop14    7:112  0  15.6M  1 loop  
    loop15    7:120  0   268K  1 loop /apex/com.android.hardware.cas  
                                      /apex/com.android.hardware.cas@1  
    loop16    7:128  0  10.8M  1 loop  
    loop17    7:136  0  73.4M  1 loop /apex/com.google.android.hardware.biometrics.face  
                                      /apex/com.google.android.hardware.biometrics.face@1  
    loop18    7:144  0   6.1M  1 loop  
    loop19    7:152  0   6.3M  1 loop  
    loop20    7:160  0   404K  1 loop /apex/com.android.hardware.biometrics.face.virtual  
                                      /apex/com.android.hardware.biometrics.face.virtual@2  
    loop21    7:168  0   4.3M  1 loop  
    loop22    7:176  0   275M  1 loop /apex/com.google.pixel.camera.hal  
                                      /apex/com.google.pixel.camera.hal@1713375038  
    loop23    7:184  0  88.5M  1 loop /apex/com.android.virt  
                                      /apex/com.android.virt@3  
    loop24    7:192  0   268K  1 loop  
    loop25    7:200  0   836K  1 loop  
    loop26    7:208  0     5M  1 loop  
    loop27    7:216  0   880K  1 loop  
    loop28    7:224  0   6.8M  1 loop  
    loop29    7:232  0  27.8M  1 loop  
    loop30    7:240  0   1.6M  1 loop  
    loop31    7:248  0   4.5M  1 loop  
    sda       8:0    0   238G  0 disk  
    ├─sda1    8:1    0   128M  0 part /mnt/vendor/persist  
    ├─sda2    8:2    0    16M  0 part  
    ├─sda3    8:3    0     1M  0 part  
    ├─sda4    8:4    0   512K  0 part  
    ├─sda5    8:5    0    64M  0 part /mnt/vendor/efs  
    ├─sda6    8:6    0    64M  0 part /mnt/vendor/efs_backup  
    ├─sda7    8:7    0    64M  0 part /mnt/vendor/modem_userdata  
    ├─sda8    8:8    0    64M  0 part  
    ├─sda9    8:9    0   128M  0 part  
    ├─sda10   8:10   0    64M  0 part /metadata  
    ├─sda11   8:11   0     2M  0 part  
    ├─sda12   8:12   0     4M  0 part  
    ├─sda13   8:13   0    64M  0 part  
    ├─sda14   8:14   0     8M  0 part  
    ├─sda15   8:15   0    64M  0 part  
    ├─sda16 259:0    0    64M  0 part  
    ├─sda17 259:1    0    16M  0 part  
    ├─sda18 259:2    0    64K  0 part  
    ├─sda19 259:3    0    64K  0 part  
    ├─sda20 259:4    0    64K  0 part  
    ├─sda21 259:5    0     1M  0 part  
    ├─sda22 259:6    0   200M  0 part  
    ├─sda23 259:7    0    64M  0 part  
    ├─sda24 259:8    0     8M  0 part  
    ├─sda25 259:9    0    64M  0 part  
    ├─sda26 259:10   0    64M  0 part  
    ├─sda27 259:11   0    16M  0 part  
    ├─sda28 259:12   0    64K  0 part  
    ├─sda29 259:13   0    64K  0 part  
    ├─sda30 259:14   0    64K  0 part  
    ├─sda31 259:15   0     1M  0 part  
    ├─sda32 259:16   0   200M  1 part /mnt/vendor/modem_img  
    ├─sda33 259:17   0   7.9G  0 part  
    └─sda34 259:18   0 228.6G  0 part  
    sdb       8:16   0    64M  0 disk  
    ├─sdb1    8:17   0    24K  0 part  
    ├─sdb2    8:18   0    80K  0 part  
    ├─sdb3    8:19   0   540K  0 part  
    ├─sdb4    8:20   0   100K  0 part  
    ├─sdb5    8:21   0     4M  0 part  
    ├─sdb6    8:22   0   256K  0 part  
    ├─sdb7    8:23   0    20M  0 part  
    ├─sdb8    8:24   0     1M  0 part  
    ├─sdb9    8:25   0    96K  0 part  
    ├─sdb10   8:26   0     4M  0 part  
    ├─sdb11   8:27   0    36K  0 part  
    └─sdb12   8:28   0   352K  0 part  
    sdc       8:32   0    64M  0 disk  
    ├─sdc1    8:33   0    24K  0 part  
    ├─sdc2    8:34   0    80K  0 part  
    ├─sdc3    8:35   0   540K  0 part  
    ├─sdc4    8:36   0   100K  0 part  
    ├─sdc5    8:37   0     4M  0 part  
    ├─sdc6    8:38   0   256K  0 part  
    ├─sdc7    8:39   0    20M  0 part  
    ├─sdc8    8:40   0     1M  0 part  
    ├─sdc9    8:41   0    96K  0 part  
    ├─sdc10   8:42   0     4M  0 part  
    ├─sdc11   8:43   0    36K  0 part  
    └─sdc12   8:44   0   352K  0 part  
    sdd       8:48   0     4M  0 disk  
    ├─sdd1    8:49   0     8K  0 part  
    ├─sdd2    8:50   0     8K  0 part  
    ├─sdd3    8:51   0     8K  0 part  
    └─sdd4    8:52   0   3.2M  0 part  
    zram0   253:0    0   5.6G  0 disk  
    loop32    7:256  0   268K  1 loop /apex/com.android.apex.cts.shim  
                                      /apex/com.android.apex.cts.shim@1  
    loop33    7:264  0   1.8M  1 loop  
    loop34    7:272  0  20.4M  1 loop  
    loop35    7:280  0  20.1M  1 loop  
    loop36    7:288  0   7.8M  1 loop /apex/com.android.runtime  
                                      /apex/com.android.runtime@1  
    loop37    7:296  0  13.6M  1 loop  
    loop38    7:304  0  35.9M  1 loop /apex/com.android.i18n  
                                      /apex/com.android.i18n@1  
    loop39    7:312  0  25.7M  1 loop  
    loop40    7:320  0  28.5M  1 loop  
    loop41    7:328  0  22.9M  1 loop  
    loop42    7:336  0   6.1M  1 loop /apex/com.android.devicelock  
                                      /apex/com.android.devicelock@1  
    loop43    7:344  0  18.8M  1 loop  
    loop44    7:352  0   4.6M  1 loop  
    loop45    7:360  0   348K  1 loop  
    loop46    7:368  0   9.6M  1 loop  
    loop47    7:376  0   808K  1 loop  
    loop48    7:384  0     1G  0 loop  
      
  
---|---  
  
插上U盘后再运行一次
    
    
    1  
    

| 
    
    
    sudo lsblk  
      
  
---|---  
  
结果和上面用右眼对比，发现多了 `sde` ，接下来对 `sde` 进行操作。

插上U盘后，Android 系统会自动挂载，如果没有挂载，`mount /dev/sde2` 。 `lsblk` 命令可以直接看到挂载的路径，我这里挂载到的路径是 `/mnt/media_rw/3685-3471/` 。

接下来直接 `wget` 下载即可
    
    
    1  
    

| 
    
    
    sudo wget https://mirrors.hit.edu.cn/archlinux/iso/latest/archlinux-2025.08.01-x86_64.iso -O /mnt/media_rw/3685-3471/archlinux-2025.08.01-x86_64.iso  
      
  
---|---  
  
使用后记得要**弹出设备** ，确保已经把文件写入到U盘里。如果系统没有识别U盘，直接 `umount` 。

# [](<#后记> "后记")后记

系统没识别的情况我还没试过，因为我这次的U盘是已经做好 ventoy 了的，文件系统是 exFAT，Android 系统可以直接识别。像其它的 NTFS，Btrfs 我就不清楚了。（题外话：上次那个 Android 系统的投影仪不认 exFAT，只认 NTFS？？）

如果可以的话，不能识别的U盘应该也能在 Termux 上直接做成 ventoy 吧。

* * *

Submit

### Comments