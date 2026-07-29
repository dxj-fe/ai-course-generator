"use client";

import {
  AlertTriangle,
  ArrowLeft,
  Box,
  Check,
  CircleDot,
  Code2,
  Focus,
  GitBranch,
  Info,
  Maximize2,
  Minus,
  MousePointer2,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  Sprout,
  X,
} from "lucide-react";
import Link from "next/link";
import {
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  FLOW_CANVAS,
  FLOW_EDGES,
  FLOW_NODES,
  FLOW_RISK_SUMMARY,
  FLOW_STAGE_META,
  getFlowNode,
  type FlowEdge,
  type FlowNode,
  type FlowRisk,
  type FlowStage,
} from "./course-flow-data";
import styles from "./course-flow-inspector.module.css";

const NODE_WIDTH = 236;
const NODE_HEIGHT = 132;
const MIN_SCALE = 0.18;
const MAX_SCALE = 1.45;

type Viewport = { x: number; y: number; scale: number };
type Filter = "all" | FlowStage | "high";

const riskLabel: Record<FlowRisk, string> = {
  low: "稳定",
  medium: "关注",
  high: "高风险",
};

export function CourseFlowInspector() {
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | undefined>(undefined);
  const [viewport, setViewport] = useState<Viewport>({
    x: 24,
    y: 32,
    scale: 0.34,
  });
  const [selectedId, setSelectedId] = useState("create-task");
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [risksOpen, setRisksOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(true);

  const selected = getFlowNode(selectedId) ?? FLOW_NODES[0];
  const visibleIds = useMemo(() => {
    if (filter === "all") return new Set(FLOW_NODES.map(({ id }) => id));
    if (filter === "high") {
      return new Set(
        FLOW_NODES.filter(({ risk }) => risk === "high").map(({ id }) => id),
      );
    }
    return new Set(
      FLOW_NODES.filter(({ stage }) => stage === filter).map(({ id }) => id),
    );
  }, [filter]);
  const searchResults = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return FLOW_NODES;
    return FLOW_NODES.filter((node) =>
      [
        node.title,
        node.subtitle,
        node.purpose,
        ...node.files,
        ...node.failures,
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalized),
    );
  }, [query]);

  const fitCanvas = useCallback(() => {
    const element = viewportRef.current;
    if (!element) return;
    const inset = 56;
    const scale = Math.max(
      MIN_SCALE,
      Math.min(
        0.72,
        (element.clientWidth - inset * 2) / FLOW_CANVAS.width,
        (element.clientHeight - inset * 2) / FLOW_CANVAS.height,
      ),
    );
    setViewport({
      x: (element.clientWidth - FLOW_CANVAS.width * scale) / 2,
      y: Math.max(40, (element.clientHeight - FLOW_CANVAS.height * scale) / 2),
      scale,
    });
  }, []);

  useEffect(() => {
    fitCanvas();
  }, [fitCanvas]);

  const focusNode = useCallback((node: FlowNode) => {
    const element = viewportRef.current;
    if (!element) return;
    const scale = Math.max(0.58, Math.min(0.88, viewport.scale));
    const width = node.width ?? NODE_WIDTH;
    setViewport({
      scale,
      x: element.clientWidth / 2 - (node.x + width / 2) * scale,
      y: element.clientHeight / 2 - (node.y + NODE_HEIGHT / 2) * scale,
    });
    setSelectedId(node.id);
    setInspectorOpen(true);
  }, [viewport.scale]);

  const updateScale = useCallback((nextScale: number) => {
    const element = viewportRef.current;
    if (!element) return;
    setViewport((current) => {
      const scale = clamp(nextScale, MIN_SCALE, MAX_SCALE);
      const centerX = element.clientWidth / 2;
      const centerY = element.clientHeight / 2;
      const worldX = (centerX - current.x) / current.scale;
      const worldY = (centerY - current.y) / current.scale;
      return {
        scale,
        x: centerX - worldX * scale,
        y: centerY - worldY * scale,
      };
    });
  }, []);

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const element = viewportRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;
    setViewport((current) => {
      const scale = clamp(
        current.scale * Math.exp(-event.deltaY * 0.0014),
        MIN_SCALE,
        MAX_SCALE,
      );
      const worldX = (pointerX - current.x) / current.scale;
      const worldY = (pointerY - current.y) / current.scale;
      return {
        scale,
        x: pointerX - worldX * scale,
        y: pointerY - worldY * scale,
      };
    });
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || isInteractiveTarget(event.target)) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: viewport.x,
      originY: viewport.y,
      moved: false,
    };
    event.currentTarget.dataset.dragging = "true";
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    drag.moved ||= Math.abs(dx) + Math.abs(dy) > 3;
    setViewport((current) => ({
      ...current,
      x: drag.originX + dx,
      y: drag.originY + dy,
    }));
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = undefined;
    delete event.currentTarget.dataset.dragging;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const selectNode = (node: FlowNode) => {
    focusNode(node);
  };

  return (
    <main className={`${styles.shell} keya-workspace-shell`}>
      <header className={`${styles.header} keya-page-reveal`}>
        <div className={styles.brandBlock}>
          <Link className={styles.backLink} href="/chat">
            <ArrowLeft size={15} />
            返回课芽
          </Link>
          <div className={styles.eyebrow}>
            <Sprout aria-hidden="true" size={13} strokeWidth={2} />
            COURSE PIPELINE / 2026.07.28
          </div>
          <h1>一句话，如何变成一门课</h1>
          <p>
            当前真实代码链路 · {FLOW_NODES.length} 个节点 ·{" "}
            {FLOW_NODES.filter(({ risk }) => risk === "high").length} 个高风险环节
          </p>
        </div>
        <div className={styles.headerActions}>
          <button
            className={styles.summaryButton}
            onClick={() => setRisksOpen((open) => !open)}
            type="button"
          >
            <AlertTriangle size={16} />
            风险摘要
            <span>{FLOW_RISK_SUMMARY.length}</span>
          </button>
          <div
            className={styles.sourceLink}
            title="对应源码文档：docs/architecture/prompt-to-html-current-flow.md"
          >
            <Code2 size={16} />
            源码事实
          </div>
        </div>
      </header>

      <section className={styles.workspace}>
        <div className={styles.canvasColumn}>
          <div className={styles.toolbar}>
            <div className={styles.filters} aria-label="流程阶段筛选">
              <FilterButton active={filter === "all"} onClick={() => setFilter("all")}>
                全链路
              </FilterButton>
              {(Object.keys(FLOW_STAGE_META) as FlowStage[]).map((stage) => (
                <FilterButton
                  active={filter === stage}
                  key={stage}
                  onClick={() => setFilter(stage)}
                >
                  <i style={{ background: FLOW_STAGE_META[stage].color }} />
                  {FLOW_STAGE_META[stage].shortLabel}
                </FilterButton>
              ))}
              <FilterButton active={filter === "high"} onClick={() => setFilter("high")}>
                <AlertTriangle size={13} />
                高风险
              </FilterButton>
            </div>
            <div className={styles.toolbarActions}>
              <button
                aria-label="搜索节点"
                className={searchOpen ? styles.toolActive : undefined}
                onClick={() => setSearchOpen((open) => !open)}
                type="button"
              >
                <Search size={16} />
              </button>
              <button aria-label="适配画布" onClick={fitCanvas} type="button">
                <Maximize2 size={16} />
              </button>
            </div>
          </div>

          {searchOpen ? (
            <div className={`${styles.searchPanel} keya-page-reveal`}>
              <Search size={16} />
              <input
                autoFocus
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索节点、错误、文件…"
                value={query}
              />
              <span>{searchResults.length} 个结果</span>
              <button
                aria-label="关闭搜索"
                onClick={() => {
                  setSearchOpen(false);
                  setQuery("");
                }}
                type="button"
              >
                <X size={15} />
              </button>
              {query ? (
                <div className={styles.searchResults}>
                  {searchResults.slice(0, 8).map((node) => (
                    <button
                      key={node.id}
                      onClick={() => {
                        focusNode(node);
                        setSearchOpen(false);
                        setQuery("");
                      }}
                      type="button"
                    >
                      <span>{String(node.index).padStart(2, "0")}</span>
                      <strong>{node.title}</strong>
                      <small>{node.subtitle}</small>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {risksOpen ? (
            <div className={`${styles.riskPanel} keya-page-reveal`}>
              <div className={styles.riskPanelHeader}>
                <div>
                  <span>WHY IT FAILS</span>
                  <h2>优先看这四处</h2>
                </div>
                <button
                  aria-label="关闭风险摘要"
                  onClick={() => setRisksOpen(false)}
                  type="button"
                >
                  <X size={16} />
                </button>
              </div>
              <div className={styles.riskList}>
                {FLOW_RISK_SUMMARY.map((risk) => (
                  <button
                    key={risk.title}
                    onClick={() => {
                      const node = getFlowNode(risk.nodeIds[0]);
                      if (node) focusNode(node);
                      setRisksOpen(false);
                    }}
                    type="button"
                  >
                    <span>{risk.priority}</span>
                    <div>
                      <strong>{risk.title}</strong>
                      <p>{risk.detail}</p>
                    </div>
                    <Focus size={15} />
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div
            className={styles.canvasViewport}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onWheel={handleWheel}
            ref={viewportRef}
          >
            <div
              className={styles.canvasWorld}
              style={{
                height: FLOW_CANVAS.height,
                transform: `translate3d(${viewport.x}px, ${viewport.y}px, 0) scale(${viewport.scale})`,
                width: FLOW_CANVAS.width,
              }}
            >
              <StageBands />
              <svg
                aria-hidden="true"
                className={styles.edges}
                height={FLOW_CANVAS.height}
                viewBox={`0 0 ${FLOW_CANVAS.width} ${FLOW_CANVAS.height}`}
                width={FLOW_CANVAS.width}
              >
                <defs>
                  <marker
                    id="arrow-main"
                    markerHeight="9"
                    markerWidth="9"
                    orient="auto"
                    refX="8"
                    refY="4.5"
                  >
                    <path d="M0,0 L9,4.5 L0,9 Z" fill="#889183" />
                  </marker>
                  <marker
                    id="arrow-risk"
                    markerHeight="9"
                    markerWidth="9"
                    orient="auto"
                    refX="8"
                    refY="4.5"
                  >
                    <path d="M0,0 L9,4.5 L0,9 Z" fill="#B56B35" />
                  </marker>
                </defs>
                {FLOW_EDGES.map((edge) => (
                  <FlowConnector
                    dimmed={
                      !visibleIds.has(edge.from) || !visibleIds.has(edge.to)
                    }
                    edge={edge}
                    key={edge.id}
                  />
                ))}
              </svg>
              {FLOW_NODES.map((node) => (
                <FlowNodeButton
                  dimmed={!visibleIds.has(node.id)}
                  key={node.id}
                  node={node}
                  onClick={() => selectNode(node)}
                  selected={node.id === selected.id}
                />
              ))}
            </div>

            <div className={styles.canvasHint}>
              <MousePointer2 size={14} />
              拖拽平移 · 滚轮缩放 · 点击查看节点
            </div>
            <div className={styles.zoomControls}>
              <button
                aria-label="放大"
                onClick={() => updateScale(viewport.scale + 0.12)}
                type="button"
              >
                <Plus size={16} />
              </button>
              <span>{Math.round(viewport.scale * 100)}%</span>
              <button
                aria-label="缩小"
                onClick={() => updateScale(viewport.scale - 0.12)}
                type="button"
              >
                <Minus size={16} />
              </button>
              <button aria-label="重置画布" onClick={fitCanvas} type="button">
                <RotateCcw size={15} />
              </button>
            </div>
          </div>
        </div>

        <aside
          className={`${styles.inspector} ${
            inspectorOpen ? styles.inspectorOpen : ""
          }`}
        >
          <button
            aria-label={inspectorOpen ? "收起节点详情" : "展开节点详情"}
            className={styles.inspectorToggle}
            onClick={() => setInspectorOpen((open) => !open)}
            type="button"
          >
            <Info size={16} />
          </button>
          <div className={styles.inspectorScroll}>
            <div className={styles.inspectorTop}>
              <div className={styles.nodeOrdinal}>
                NODE {String(selected.index).padStart(2, "0")}
              </div>
              <button
                aria-label="移动端关闭详情"
                className={styles.mobileClose}
                onClick={() => setInspectorOpen(false)}
                type="button"
              >
                <X size={18} />
              </button>
              <div
                className={`${styles.riskBadge} ${styles[`risk_${selected.risk}`]}`}
              >
                <span />
                {riskLabel[selected.risk]}
              </div>
              <h2>{selected.title}</h2>
              <p className={styles.inspectorSubtitle}>{selected.subtitle}</p>
              <p className={styles.purpose}>{selected.purpose}</p>
            </div>

            {selected.model ? (
              <div className={styles.modelCallout}>
                <Sparkles size={16} />
                <div>
                  <span>模型调用</span>
                  <strong>{selected.model}</strong>
                </div>
              </div>
            ) : null}

            <DetailSection icon={<Box size={15} />} items={selected.inputs} title="输入" />
            <DetailSection
              icon={<GitBranch size={15} />}
              items={selected.actions}
              ordered
              title="节点内发生什么"
            />
            <DetailSection
              icon={<Check size={15} />}
              items={selected.outputs}
              title="输出"
            />
            <DetailSection
              danger
              icon={<AlertTriangle size={15} />}
              items={selected.failures}
              title="故障与质量风险"
            />
            {selected.retry ? (
              <div className={styles.note}>
                <RotateCcw size={15} />
                <p>{selected.retry}</p>
              </div>
            ) : null}
            {selected.note ? (
              <div className={styles.note}>
                <Info size={15} />
                <p>{selected.note}</p>
              </div>
            ) : null}
            <div className={styles.files}>
              <div className={styles.sectionTitle}>
                <Code2 size={15} />
                <h3>源码位置</h3>
              </div>
              {selected.files.map((file) => (
                <code key={file}>{file}</code>
              ))}
            </div>
          </div>
        </aside>
      </section>
    </main>
  );
}

function FilterButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick(): void;
}) {
  return (
    <button
      aria-pressed={active}
      className={active ? styles.filterActive : undefined}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function StageBands() {
  const bands: Array<{
    stage: FlowStage;
    x: number;
    width: number;
  }> = [
    { stage: "input", x: 32, width: 920 },
    { stage: "task", x: 972, width: 910 },
    { stage: "design", x: 1902, width: 1220 },
    { stage: "page", x: 3142, width: 1190 },
    { stage: "quality", x: 4352, width: 510 },
    { stage: "delivery", x: 4882, width: 806 },
  ];
  return (
    <>
      {bands.map(({ stage, width, x }) => (
        <div
          className={styles.stageBand}
          key={stage}
          style={{
            borderColor: `${FLOW_STAGE_META[stage].color}2d`,
            left: x,
            width,
          }}
        >
          <span style={{ color: FLOW_STAGE_META[stage].color }}>
            {FLOW_STAGE_META[stage].label}
          </span>
        </div>
      ))}
    </>
  );
}

function FlowNodeButton({
  dimmed,
  node,
  onClick,
  selected,
}: {
  dimmed: boolean;
  node: FlowNode;
  onClick(): void;
  selected: boolean;
}) {
  const stage = FLOW_STAGE_META[node.stage];
  return (
    <button
      aria-label={`${node.title}，风险：${riskLabel[node.risk]}`}
      aria-pressed={selected}
      className={`${styles.flowNode} ${selected ? styles.nodeSelected : ""} ${
        dimmed ? styles.nodeDimmed : ""
      }`}
      onClick={onClick}
      style={{
        "--node-accent": stage.color,
        left: node.x,
        top: node.y,
        width: node.width ?? NODE_WIDTH,
      } as React.CSSProperties}
      type="button"
    >
      <span className={styles.nodeIndex}>
        {String(node.index).padStart(2, "0")}
      </span>
      <span
        className={`${styles.nodeRiskDot} ${styles[`risk_${node.risk}`]}`}
        title={riskLabel[node.risk]}
      />
      <strong>{node.title}</strong>
      <small>{node.subtitle}</small>
      {node.model ? (
        <span className={styles.nodeModel}>
          <Sparkles size={12} />
          {node.model.split("；")[0]}
        </span>
      ) : (
        <span className={styles.nodeModel}>
          <CircleDot size={11} />
          确定性处理
        </span>
      )}
    </button>
  );
}

function FlowConnector({
  dimmed,
  edge,
}: {
  dimmed: boolean;
  edge: FlowEdge;
}) {
  const from = getFlowNode(edge.from);
  const to = getFlowNode(edge.to);
  if (!from || !to) return null;
  const fromWidth = from.width ?? NODE_WIDTH;
  const toWidth = to.width ?? NODE_WIDTH;
  const points = resolveEdgePoints(from, to, fromWidth, toWidth, edge.kind);
  const color =
    edge.kind === "conditional" || edge.kind === "error" ? "#B56B35" : "#889183";
  return (
    <g className={dimmed ? styles.edgeDimmed : undefined}>
      <path
        className={edge.kind === "loop" ? styles.loopEdge : styles.edge}
        d={points.path}
        markerEnd={`url(#${
          edge.kind === "conditional" || edge.kind === "error"
            ? "arrow-risk"
            : "arrow-main"
        })`}
        stroke={color}
      />
      {edge.label ? (
        <g transform={`translate(${points.labelX} ${points.labelY})`}>
          <rect
            fill="#fffaf0"
            height="24"
            rx="12"
            stroke={`${color}55`}
            width={Math.max(76, edge.label.length * 13 + 20)}
            x={-Math.max(76, edge.label.length * 13 + 20) / 2}
            y="-12"
          />
          <text
            dominantBaseline="middle"
            fill={color}
            fontSize="12"
            textAnchor="middle"
          >
            {edge.label}
          </text>
        </g>
      ) : null}
    </g>
  );
}

function resolveEdgePoints(
  from: FlowNode,
  to: FlowNode,
  fromWidth: number,
  toWidth: number,
  kind: FlowEdge["kind"],
) {
  const fromCenter = { x: from.x + fromWidth / 2, y: from.y + NODE_HEIGHT / 2 };
  const toCenter = { x: to.x + toWidth / 2, y: to.y + NODE_HEIGHT / 2 };
  const movingRight = toCenter.x >= fromCenter.x;
  const x1 = movingRight ? from.x + fromWidth : from.x;
  const x2 = movingRight ? to.x : to.x + toWidth;
  const y1 = fromCenter.y;
  const y2 = toCenter.y;

  if (kind === "loop") {
    const bendY =
      Math.min(from.y, to.y) - 52 - (Math.abs(from.x - to.x) > 800 ? 34 : 0);
    return {
      path: `M ${x1} ${y1} C ${x1 + (movingRight ? 60 : -60)} ${bendY}, ${x2 + (movingRight ? -60 : 60)} ${bendY}, ${x2} ${y2}`,
      labelX: (x1 + x2) / 2,
      labelY: bendY,
    };
  }

  if (Math.abs(y2 - y1) > 110) {
    const midX = (x1 + x2) / 2;
    return {
      path: `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`,
      labelX: midX,
      labelY: (y1 + y2) / 2,
    };
  }

  const distance = Math.max(60, Math.abs(x2 - x1) * 0.44);
  return {
    path: `M ${x1} ${y1} C ${x1 + (movingRight ? distance : -distance)} ${y1}, ${x2 + (movingRight ? -distance : distance)} ${y2}, ${x2} ${y2}`,
    labelX: (x1 + x2) / 2,
    labelY: (y1 + y2) / 2 - 18,
  };
}

function DetailSection({
  danger = false,
  icon,
  items,
  ordered = false,
  title,
}: {
  danger?: boolean;
  icon: React.ReactNode;
  items: string[];
  ordered?: boolean;
  title: string;
}) {
  const List = ordered ? "ol" : "ul";
  return (
    <section className={`${styles.detailSection} ${danger ? styles.danger : ""}`}>
      <div className={styles.sectionTitle}>
        {icon}
        <h3>{title}</h3>
      </div>
      <List>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </List>
    </section>
  );
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function isInteractiveTarget(target: EventTarget) {
  return target instanceof Element && Boolean(target.closest("button, a, input"));
}
