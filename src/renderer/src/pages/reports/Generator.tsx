// 报告生成器卡片（DESIGN §4）：类型/日期/模板/补充要求/素材预览/生成按钮。
import { useEffect, useState, type JSX } from 'react';
import type { MaterialPreview, ReportGenOptions, ReportTemplate, ReportType } from '@shared/types';
import { api } from '../../api';
import Card from '../../components/Card';
import Button from '../../components/Button';
import SegmentControl from '../../components/SegmentControl';
import { Input, Select, Textarea } from '../../components/FormControls';
import './Generator.css';

const TYPE_OPTIONS: { value: ReportType; label: string }[] = [
  { value: 'daily', label: '日报' },
  { value: 'weekly', label: '周报' },
  { value: 'monthly', label: '月报' },
];

const TYPE_LABEL: Record<ReportType, string> = { daily: '日报', weekly: '周报', monthly: '月报' };

const TEMPLATE_OPTIONS: { value: ReportTemplate; label: string }[] = [
  { value: 'standard', label: '标准' },
  { value: 'concise', label: '简洁' },
  { value: 'technical', label: '技术' },
  { value: 'okr', label: 'OKR' },
];

export type GeneratingStage = 'idle' | 'collecting' | 'generating';

export interface GeneratorState {
  type: ReportType;
  date: string;
  template: ReportTemplate;
  extraInstructions: string;
}

export interface GeneratorProps {
  state: GeneratorState;
  onChange: (next: GeneratorState) => void;
  stage: GeneratingStage;
  onGenerate: () => void;
}

function formatPreviewText(p: MaterialPreview, type: ReportType): string {
  const parts = [`${p.sessionCount} 段活动`, `${p.commitCount} 次提交`, `${p.noteCount} 条速记`];
  if (p.screenshotCount > 0) parts.push(`${p.screenshotCount} 次截图分析`);
  if (type !== 'daily' && p.dailyReportCount > 0) parts.push(`${p.dailyReportCount} 篇日报可复用`);
  return `素材：${parts.join(' · ')}`;
}

export default function Generator({ state, onChange, stage, onGenerate }: GeneratorProps): JSX.Element {
  const [preview, setPreview] = useState<MaterialPreview | null>(null);

  useEffect(() => {
    let disposed = false;
    const opts: ReportGenOptions = { type: state.type, date: state.date, template: state.template };
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const result = await api.reports.preview(opts);
          if (!disposed) setPreview(result);
        } catch {
          if (!disposed) setPreview(null);
        }
      })();
    }, 300);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [state.type, state.date, state.template]);

  const stageText = stage === 'collecting' ? '整理素材…' : stage === 'generating' ? 'AI 撰写中…' : `生成${TYPE_LABEL[state.type]}`;

  return (
    <Card title="生成日报">
      <div className="gd-gen__field">
        <span className="gd-gen__field-label">类型</span>
        <SegmentControl block options={TYPE_OPTIONS} value={state.type} onChange={(type) => onChange({ ...state, type })} />
      </div>

      <div className="gd-gen__field">
        <span className="gd-gen__field-label">日期{state.type !== 'daily' ? `（${state.type === 'weekly' ? '任选周内一天' : '任选月内一天'}）` : ''}</span>
        <Input type="date" value={state.date} onChange={(e) => onChange({ ...state, date: e.target.value })} style={{ width: '100%' }} />
      </div>

      <div className="gd-gen__field">
        <span className="gd-gen__field-label">模板</span>
        <Select value={state.template} onChange={(template) => onChange({ ...state, template })} options={TEMPLATE_OPTIONS} style={{ width: '100%' }} />
      </div>

      <div className="gd-gen__field">
        <span className="gd-gen__field-label">补充要求（可选）</span>
        <Textarea
          rows={2}
          placeholder="例如：重点写清 X 项目的进展"
          value={state.extraInstructions}
          onChange={(e) => onChange({ ...state, extraInstructions: e.target.value })}
          style={{ width: '100%' }}
        />
      </div>

      <div className="gd-gen__preview">{preview ? formatPreviewText(preview, state.type) : ''}</div>

      <Button variant="primary" full loading={stage !== 'idle'} disabled={stage !== 'idle'} onClick={onGenerate}>
        {stageText}
      </Button>
    </Card>
  );
}
