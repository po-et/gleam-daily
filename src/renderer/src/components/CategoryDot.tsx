// 分类色点（DESIGN §2）：8px 圆点用 CATEGORY_META.color；分类标签 = 色点 + 12.5px 文字。
import type { CSSProperties, JSX } from 'react';
import type { Category } from '@shared/types';
import { CATEGORY_META } from '@shared/categories';

export function CategoryDot({ category, size = 8 }: { category: Category; size?: number }): JSX.Element {
  const style: CSSProperties = {
    display: 'inline-block',
    width: size,
    height: size,
    borderRadius: '50%',
    background: CATEGORY_META[category].color,
    flexShrink: 0,
  };
  return <span style={style} />;
}

export function CategoryLabel({ category }: { category: Category }): JSX.Element {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--text-2)' }}>
      <CategoryDot category={category} />
      {CATEGORY_META[category].label}
    </span>
  );
}
