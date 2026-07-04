// 右侧预览编辑区（DESIGN §4）：纸感 720px 居中，Markdown 渲染 / 编辑切换、复制、导出。
import { useEffect, useState, type JSX } from 'react';
import type { Report, ReportTemplate, ReportType } from '@shared/types';
import { api } from '../../api';
import { formatDateHeading } from '../../lib/format';
import { renderMarkdown } from '../../lib/markdown';
import { useToast } from '../../components/Toast';
import Button from '../../components/Button';
import SegmentControl from '../../components/SegmentControl';
import EmptyState from '../../components/EmptyState';
import { IconCopy, IconDownload, IllustrationPaper } from '../../components/icons';
import './PreviewPane.css';

const TYPE_LABEL: Record<ReportType, string> = { daily: '日报', weekly: '周报', monthly: '月报' };
const TEMPLATE_LABEL: Record<ReportTemplate, string> = { standard: '标准', concise: '简洁', technical: '技术', okr: 'OKR' };

export interface PreviewPaneProps {
  report: Report | null;
  onSaved: (id: number, contentMd: string) => void;
}

export default function PreviewPane({ report, onSaved }: PreviewPaneProps): JSX.Element {
  const { showToast } = useToast();
  const [mode, setMode] = useState<'preview' | 'edit'>('preview');
  const [draft, setDraft] = useState('');

  useEffect(() => {
    setDraft(report?.contentMd ?? '');
    setMode('preview');
  }, [report?.id]);

  if (!report) {
    return <EmptyState icon={<IllustrationPaper />} text="选一个日期，让 AI 把你的一天整理成报告。" />;
  }

  // 用 const 重新绑定：narrowing 后的非空类型才能安全地穿过下面这些闭包（persist/exportMd）。
  const currentReport = report;

  async function persist(): Promise<void> {
    if (draft === currentReport.contentMd) return;
    try {
      await api.reports.update(currentReport.id, draft);
      onSaved(currentReport.id, draft);
    } catch {
      showToast('保存失败，请重试', 'error');
    }
  }

  async function copyMarkdown(): Promise<void> {
    try {
      await navigator.clipboard.writeText(draft);
      showToast('已复制 Markdown', 'success');
    } catch {
      showToast('复制失败，请手动选择文本复制', 'error');
    }
  }

  function exportMd(): void {
    const blob = new Blob([draft], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `拾光日报_${TYPE_LABEL[currentReport.type]}_${currentReport.periodStart}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="gd-preview">
      <div className="gd-preview__toolbar">
        <SegmentControl
          options={[
            { value: 'edit', label: '编辑' },
            { value: 'preview', label: '预览' },
          ]}
          value={mode}
          onChange={(next) => {
            void persist();
            setMode(next);
          }}
        />
        <div className="gd-preview__toolbar-actions">
          <Button variant="ghost" size="sm" onClick={() => void copyMarkdown()}>
            <IconCopy size={14} />
            复制 Markdown
          </Button>
          <Button variant="ghost" size="sm" onClick={exportMd}>
            <IconDownload size={14} />
            导出 .md
          </Button>
        </div>
      </div>

      <div className="gd-paper">
        <div className="gd-paper__meta gd-mono">
          {formatDateHeading(currentReport.periodStart)} · {TYPE_LABEL[currentReport.type]} · {TEMPLATE_LABEL[currentReport.template]} · {currentReport.model}
        </div>
        {mode === 'edit' ? (
          <textarea
            className="gd-paper__edit gd-no-drag"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => void persist()}
          />
        ) : (
          <div className="gd-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(draft) }} />
        )}
      </div>
    </div>
  );
}
