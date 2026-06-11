---
title: 编译 LineageOS 并安装到虚拟机
date: 2026-05-14
tags: [手机, Linux]
categories: [教程]
title_en: 
content_en: 
---

本文章描述了如何在 Linux 上编译 LineageOS 23.2 并安装到虚拟机。

这篇文章分为几个步骤：下载源代码、编译、安装。

~~好久没写博客了~~

# [](<#准备> "准备")准备

## [](<#环境> "环境")环境

我的编译环境：Arch Linux (linux kernel 7.0.5)、24核CPU+32G内存+1T固态硬盘。

按照官方文档的说法，在 Ubuntu 上编译需要下载以下软件包：

`bc bison build-essential ccache curl flex g++-multilib gcc-multilib git git-lfs gnupg gperf imagemagick protobuf-compiler python3-protobuf lib32readline-dev lib32z1-dev libdw-dev libelf-dev libgnutls28-dev lz4 libsdl1.2-dev libssl-dev libxml2 libxml2-utils lzop pngcrush rsync sch