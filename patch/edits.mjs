// 补丁入口：把两个改动集合并起来，供引擎与验证脚本共用
import { SERVER_EDITS, DEFAULT_FILE } from './server-edits.mjs';
import { CLIENT_EDITS } from './client-edits.mjs';

/** 按文件归组：没写 file 的服务端改动落在 lib/index.js */
export function buildGroups() {
  const byFile = new Map();
  const push = (rel, edit) => {
    const key = edit.file ?? rel;
    if (!byFile.has(key)) byFile.set(key, []);
    byFile.get(key).push(edit);
  };
  for (const edit of SERVER_EDITS) push(DEFAULT_FILE, edit);
  for (const edit of CLIENT_EDITS) push('lib/client.js', edit);
  return [...byFile.entries()].map(([rel, edits]) => ({ rel, edits }));
}
