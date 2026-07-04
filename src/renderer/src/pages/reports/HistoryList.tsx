// 历史列表（DESIGN §4）：倒序，选中项左侧 3px accent 竖条，hover 显删除。
import type { JSX } from 'react';
import type { Report, ReportTemplate, ReportType } from '@shared/types';
import { formatDateShort } from '../../lib/format';
import Card from '../../components/Card';
import Button from '../../components/Button';
import EmptyState from '../../components/EmptyState';
import { IconTrash, IllustrationPaper } from '../../components/icons';
import './HistoryList.css';

const TYPE_LABEL: Record<ReportType, string> = { daily: '日报', weekly: '周报', monthly: '月报' };
const TEMPLATE_LABEL: Record<ReportTemplate, string> = { standard: '标准', concise: '简洁', technical: '技术', okr: 'OKR' };

export interface HistoryListProps {
  reports: Report[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onDelete: (id: number) => void;
}

export default function HistoryList({ reports, selectedId, onSelect, onDelete }: HistoryListProps): JSX.Element {
  const sorted = [...reports].sort((a, b) => b.createdTs - a.createdTs);

  return (
    <Card title="历史">
      {sorted.length === 0 ? (
        <EmptyState icon={<IllustrationPaper size={40} />} text="还没有生成过报告。" />
      ) : (
        <div className="gd-history__list">
          {sorted.map((report) => (
            <button
              key={report.id}
              type="button"
              className="gd-history__item gd-no-drag"
              data-active={report.id === selectedId}
              onClick={() => onSelect(report.id)}
            >
              <span className="gd-history__tag">{TYPE_LABEL[report.type]}</span>
              <span className="gd-history__meta">
                <div className="gd-history__date">{formatDateShort(report.periodStart)}</div>
                <div className="gd-history__template">{TEMPLATE_LABEL[report.template]}</div>
              </span>
              <Button
                variant="ghost"
                size="sm"
                iconOnly
                className="gd-history__delete"
                aria-label="删除"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(report.id);
                }}
              >
                <IconTrash size={13} />
              </Button>
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}
