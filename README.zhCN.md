# 《矩阵潜袭》国服对战平台开发指南

## 简介

`netrunner-arena` 是 [mtgred/netrunner](https://github.com/mtgred/netrunner)，即 [Jinteki.net](https://www.jinteki.net/) 的国服 fork 分支。

## 分支说明

本项目的分支使用规则如下：

* `master`：主分支，不允许进行任何修改与提交。此分支仅用于同步上游改动。
* `netrunner-arena/dev`：开发分支，所有修改与提交都提交到该分支上，用于进行本地测试。
* `netrunner-arena/prod`：稳定分支，不允许进行任何修改与提交。在 `dev` 分支上验证通过的功能以及 `master` 分支上同步的上游改动合并到此分支，并定期添加 Release 发行版，用于线上生产环境部署。

## 部署流程

```shell
# 国服使用中文卡图
lein fetch --no-card-images
lein create-indexes
npm ci
npm run release
lein uberjar
```

## 添加牌背流程

* 在 `resources/public/img/card-backs/` 中添加卡图文件。
* 编辑 `data/card-backs.edn` 文件，添加卡背文件信息。
* 使用如下命令更新数据库：`lein update-prizes --local <data文件夹所在路径> --no-card-images`

## 启动命令

```shell
java -XX:-OmitStackTraceInFastThrow -jar target/netrunner-standalone.jar
```

## 第三方开源项目使用

* [multiaccess-studios/jnet-stats](https://github.com/multiaccess-studios/jnet-stats)
* [migueldlr/makers-eye](https://github.com/migueldlr/makers-eye)

## 维护者

* [Eric03742](https://github.com/eric03742)
