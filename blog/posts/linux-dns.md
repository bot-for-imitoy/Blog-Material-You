---
title: Linux 网速之 DNS
date: 2026-01-09
tags: [Linux]
categories: [笔记]
title_en: 
content_en: 
---

这种情况多半是 DNS 出了问题，看一下 `/etc/NetworkManager/` 和 `/etc/NetworkManager/conf.d` 中有没有 DNS 相关设置。一般来说，自家网关都会给一个默认 DNS，IPv4 地址是 `192.168.1.1`，IPv6 地址是 `fe80::1%wlan0`，其中 `wlan0` 是你设备地址。

不要用 `1.1.1.1`，`8.8.8.8`，`114.114.114.114` 等等，肯定没你本地 DNS 解析快，而且还不稳定。Cloudflare DNS 反正我是常年连不上；Google DNS 看运气了，甚至前几天还异常稳定；114 DNS 竟然还 ping 不通？？

为什么是 DNS 出问题了呢？因为如果不是 DNS，那纯粹就是运营商给你限速和其它因素。

* * *

Submit

### Comments