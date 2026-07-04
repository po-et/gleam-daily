// 素材页 - 屏幕分析 tab（DESIGN §5）：时间+summary 列表；skipped 灰显；截图关闭时顶部提示条。
import type { JSX } from 'react';
import type { ScreenshotAnalysis } from '@shared/types';
import { CategoryDot } from '../../components/CategoryDot';
import Card from '../../components/Card';
import EmptyState from '../../components/EmptyState';
import { IllustrationLayers } from '../../components/icons';
import { formatClockTime } from '../../lib/format';
import './ScreenshotsTab.css';

function statusText(item: ScreenshotAnalysis): { text: string; muted: boolean } {
  if (item.status === 'skipped') return { text: '已跳过（隐私）', muted: true };
  if (item.status === 'failed') return { text: '分析失败', muted: true };
  if (item.status === 'pending') return { text: '分析中…', muted: true };
  return { text: item.summary || '（无摘要）', muted: false };
}

export interface ScreenshotsTabProps {
  analyses: ScreenshotAnalysis[];
  screenshotsEnabled: boolean;
}

export default function ScreenshotsTab({ analyses, screenshotsEnabled }: ScreenshotsTabProps): JSX.Element {
  const sorted = [...analyses].sort((a, b) => b.ts - a.ts);

  return (
    <Card>
      {!screenshotsEnabled ? (
        <div className="gd-shots__banner">
          <span>截图功能未开启，无法生成屏幕活动分析</span>
          <a href="#/settings" style={{ color: 'var(--accent)', fontSize: 13, textDecoration: 'none' }}>
            去开启 →
          </a>
        </div>
      ) : null}
      {sorted.length === 0 ? (
        <EmptyState icon={<IllustrationLayers />} text="这一天还没有屏幕活动分析。" />
      ) : (
        sorted.map((item) => {
          const { text, muted } = statusText(item);
          return (
            <div className="gd-shots__row" key={item.id}>
              <span className="gd-shots__time gd-mono">{formatClockTime(item.ts)}</span>
              {item.category ? <CategoryDot category={item.category} /> : null}
              <span className={['gd-shots__summary', muted ? 'gd-shots__summary--muted' : ''].filter(Boolean).join(' ')}>{text}</span>
            </div>
          );
        })
      )}
    </Card>
  );
}
