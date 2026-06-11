---
title: Magisk Bootloader
date: 2025-12-07
tags: [手机, root]
categories: [教程]
title_en: 
content_en: 
---

# [](<#背景> "背景")背景

众所周知，Google 为了不支持 root 手机，但又不能明面拒绝，便把选择权交给了用户：让用户在 root 和 AI 功能中二选一。好吧，root 对于我来说好像用处不大了，先卸载一段时间体验一下 AI 功能吧。

# [](<#准备> "准备")准备

  * 已 root 手机一台（Google Pixel 9）
  * 电脑
  * 数据线



# [](<#下载镜像> "下载镜像")下载镜像

首先[下载镜像](<https://developers.google.com/android/ota?hl=zh-cn>)，建议选择与手机版本号相同的镜像。我是从 Magisk 官网中的链接进入的。

下载之后记得验证**校验和** 。

# [](<#卸载-Magisk> "卸载 Magisk")卸载 Magisk

进入 Magisk 应用，点击卸载，选择完全卸载。

# [](<#刷入官方镜像> "刷入官方镜像")刷入官方镜像

手机连接电脑，打开 USB 调试。之后电脑运行
    
    
    1  
    

| 
    
    
    adb reboot recovery  
      
  
---|---  
  
手机会重启到有一个 Android 机器人和一个感叹号的界面。这个时候按住电源键，再**按一下** 音量键就会出现 Recovery 菜单，然后选择 Update from adb 。

然后电脑传输镜像：
    
    
    1  
    

| 
    
    
    adb sideload <your-image>.zip  
      
  
---|---  
  
传输完成后（注意结果是 exit with code 0 才算成功），Recovery 菜单会出现。

# [](<#Bootloader-上锁> "Bootloader 上锁")Bootloader 上锁

在 Recovery 菜单中选择 Reboot to bootloader 。如果你的手机没有这个选项，可以选择 Reboot system now ，重启之后输入 `adb reboot bootloader` 来进入 Bootloader 。

**注意：下面的操作会抹掉手机上的所有数据。如果你希望备份，可以先选择重启，备份好所有数据再继续。数据无价！！！ **

进入 Bootloader 后，会出现一个感叹号。这时候电脑运行：
    
    
    1  
    

| 
    
    
    fastboot flashing lock  
      
  
---|---  
  
这时候手机会询问你是否继续。按照提示操作，之后确认即可。确认之后可能会等很长时间，因为这个步骤是在抹掉手机数据。

上锁之后重启即可。

* * *

Submit

### Comments