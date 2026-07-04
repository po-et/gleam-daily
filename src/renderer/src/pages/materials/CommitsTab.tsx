// 素材页 - 提交 tab（DESIGN §5）：按 repo 分组，顶部刷新触发 collectCommits。
import type { JSX } from 'react';
import type { GitCommit } from '@shared/types';
import { shortHash, truncate } from '../../lib/format';
import Card from '../../components/Card';
import Button from '../../components/Button';
import EmptyState from '../../components/EmptyState';
import { IconRefresh, IllustrationLayers } from '../../components/icons';
import './CommitsTab.css';

export interface CommitsTabProps {
  commits: GitCommit[];
  refreshing: boolean;
  onRefresh: () => void;
}

export default function CommitsTab({ commits, refreshing, onRefresh }: CommitsTabProps): JSX.Element {
  const groups = new Map<string, GitCommit[]>();
  for (const c of commits) {
    const list = groups.get(c.repo) ?? [];
    list.push(c);
    groups.set(c.repo, list);
  }
  const groupList = Array.from(groups.entries())
    .map(([repo, list]) => ({ repo, list: [...list].sort((a, b) => b.ts - a.ts) }))
    .sort((a, b) => (b.list[0]?.ts ?? 0) - (a.list[0]?.ts ?? 0));

  return (
    <Card>
      <div className="gd-commits__toolbar">
        <Button variant="ghost" size="sm" loading={refreshing} onClick={onRefresh}>
          <IconRefresh size={14} />
          刷新
        </Button>
      </div>
      {groupList.length === 0 ? (
        <EmptyState icon={<IllustrationLayers />} text="这一天还没有 Git 提交。" />
      ) : (
        groupList.map(({ repo, list }) => (
          <div className="gd-commits__group" key={repo}>
            <div className="gd-commits__group-head">
              {repo}
              <span className="gd-commits__group-count">{list.length} 次提交</span>
            </div>
            {list.map((c) => (
              <div className="gd-commits__row" key={c.id}>
                <span className="gd-commits__hash gd-mono">{shortHash(c.hash)}</span>
                <span className="gd-commits__message">{truncate(c.message, 72)}</span>
                <span className="gd-commits__stat gd-mono">
                  <span className="gd-commits__ins">+{c.insertions}</span>
                  <span className="gd-commits__del">−{c.deletions}</span>
                </span>
              </div>
            ))}
          </div>
        ))
      )}
    </Card>
  );
}
