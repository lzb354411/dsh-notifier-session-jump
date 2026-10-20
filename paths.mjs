// 统一的路径解析：所有脚本都从这里取路径，不要再在别处写死绝对路径。
//
// 这样做的两个理由：
//   ① 这台机器上跑得通 ≠ 别人机器上跑得通 —— 写死 `C:\Users\<某人>\...` 的脚本换台电脑就废；
//   ② 仓库要公开，不该把人家的本机用户名与目录结构一起发出去。
//
// 两个值都可以用环境变量覆盖；不设时按下面的规则推导（在你本机上推导结果与原来的写死值一致）。

import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 本项目目录（本文件所在目录）。 */
export const PROJECT_DIR = path.dirname(fileURLToPath(import.meta.url));

/**
 * 目标插件目录。
 * 覆盖：环境变量 `DSH_NOTIFIER_PLUGIN_DIR`
 * 缺省：`~/.dsh/profiles/<DSH_PROFILE 或 desktop>/node_modules/@wingsky-1/dsh-notifier`
 */
export const PLUGIN_DIR =
  process.env.DSH_NOTIFIER_PLUGIN_DIR ??
  path.join(
    os.homedir(),
    '.dsh',
    'profiles',
    process.env.DSH_PROFILE ?? 'desktop',
    'node_modules',
    '@wingsky-1',
    'dsh-notifier',
  );

/**
 * 备份根目录。
 * 覆盖：环境变量 `DSH_NOTIFIER_BACKUP_ROOT`
 * 缺省：本项目目录的上两级下的 `_backup`
 *      —— 典型布局 `<工作区根>\<分类>\<项目>\`，于是得到 `<工作区根>\_backup\`。
 */
export const BACKUP_ROOT =
  process.env.DSH_NOTIFIER_BACKUP_ROOT ?? path.resolve(PROJECT_DIR, '..', '..', '_backup');

/** 目标插件里两个被改的产物文件。 */
export const SERVER_ARTIFACT = path.join(PLUGIN_DIR, 'lib', 'index.js');
export const CLIENT_ARTIFACT = path.join(PLUGIN_DIR, 'lib', 'client.js');
