export type TuiLayoutMode = 'wide' | 'stacked';

export type TuiPaneRect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

export type TuiLayout = {
  mode: TuiLayoutMode;
  header: TuiPaneRect;
  clusters: TuiPaneRect;
  members: TuiPaneRect;
  detail: TuiPaneRect;
  footer: TuiPaneRect;
};

export function computeTuiLayout(width: number, height: number): TuiLayout {
  const safeWidth = Math.max(60, width);
  const safeHeight = Math.max(16, height);
  const footerHeight = 5;
  const contentTop = 1;
  const contentHeight = Math.max(6, safeHeight - 1 - footerHeight);
  const header = { top: 0, left: 0, width: safeWidth, height: 1 };
  const footer = { top: safeHeight - footerHeight, left: 0, width: safeWidth, height: footerHeight };

  if (safeWidth >= 140) {
    const leftWidth = Math.floor(safeWidth * 0.34);
    const middleWidth = Math.floor(safeWidth * 0.30);
    const rightWidth = safeWidth - leftWidth - middleWidth;
    return {
      mode: 'wide',
      header,
      clusters: { top: contentTop, left: 0, width: leftWidth, height: contentHeight },
      members: { top: contentTop, left: leftWidth, width: middleWidth, height: contentHeight },
      detail: { top: contentTop, left: leftWidth + middleWidth, width: rightWidth, height: contentHeight },
      footer,
    };
  }

  const clustersHeight = Math.max(4, Math.floor(contentHeight * 0.38));
  const membersHeight = Math.max(4, Math.floor(contentHeight * 0.27));
  const detailHeight = Math.max(4, contentHeight - clustersHeight - membersHeight);
  return {
    mode: 'stacked',
    header,
    clusters: { top: contentTop, left: 0, width: safeWidth, height: clustersHeight },
    members: { top: contentTop + clustersHeight, left: 0, width: safeWidth, height: membersHeight },
    detail: { top: contentTop + clustersHeight + membersHeight, left: 0, width: safeWidth, height: detailHeight },
    footer,
  };
}
