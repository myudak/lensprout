import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  Add01Icon,
  Analytics01Icon,
  ArrowDownRight01Icon,
  ArrowUpRight01Icon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  DashboardSquare01Icon,
  Download01Icon,
  Invoice01Icon,
  Moon02Icon,
  Notification01Icon,
  PackageIcon,
  Search01Icon,
  Settings02Icon,
  Sun01Icon,
  UserGroupIcon,
} from '@hugeicons/core-free-icons';

/*
 * A generic, fictional shadcn-style analytics dashboard used as recording material for Lensprout
 * demos. All names and numbers are made up. Charts are plain SVG so the page has no chart library.
 */

// Deterministic pseudo-random data, so every recording looks the same.
function series(n: number, seed: number, base: number, swing: number, trend: number) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  return Array.from({ length: n }, (_, i) =>
    Math.round(base + trend * i + Math.sin(i / 3 + seed) * swing * 0.5 + (rnd() - 0.5) * swing),
  );
}
const RANGES = { '7d': 7, '30d': 30, '90d': 90 } as const;
type Range = keyof typeof RANGES;
const money = (n: number) => '$' + n.toLocaleString('en-US');

const KPIS = [
  { label: 'Total revenue', value: '$48,294', delta: 12.5, data: series(16, 3, 40, 14, 2) },
  { label: 'Subscriptions', value: '+2,350', delta: 8.1, data: series(16, 7, 30, 10, 1.5) },
  { label: 'Active users', value: '12,934', delta: 4.3, data: series(16, 11, 50, 12, 0.8) },
  { label: 'Churn rate', value: '2.4%', delta: -0.6, data: series(16, 19, 30, 8, -0.9) },
];
const SOURCES = [
  { label: 'Organic search', value: 42, color: 'var(--chart-1)' },
  { label: 'Direct', value: 26, color: 'var(--chart-2)' },
  { label: 'Social', value: 18, color: 'var(--chart-3)' },
  { label: 'Referral', value: 14, color: 'var(--chart-4)' },
];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SALES = series(12, 5, 3200, 1400, 160);
const STATUSES = ['Paid', 'Pending', 'Paid', 'Refunded', 'Paid', 'Pending'] as const;
const NAMES = [
  'Olivia Martin',
  'Jackson Lee',
  'Isabella Nguyen',
  'William Kim',
  'Sofia Davis',
  'Liam Johnson',
  'Emma Brown',
  'Noah Wilson',
  'Ava Garcia',
  'Lucas Patel',
];
const ORDERS0 = NAMES.map((name, i) => ({
  id: `INV-${(1042 + i * 7).toString()}`,
  name,
  email: name.toLowerCase().replace(' ', '.') + '@example.com',
  status: STATUSES[i % STATUSES.length]!,
  amount: 120 + ((i * 397) % 1900),
  date: `Oct ${18 - i}, 2026`,
}));
type Order = (typeof ORDERS0)[number];

export default function Dashboard() {
  const [dark, setDark] = useState(false);
  const [range, setRange] = useState<Range>('30d');
  const [query, setQuery] = useState('');
  const [orders, setOrders] = useState<Order[]>(ORDERS0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState(false);
  const [toast, setToast] = useState('');

  useEffect(() => setDark(document.documentElement.classList.contains('dark')), []);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const filtered = orders.filter((o) =>
    (o.name + o.email + o.id + o.status).toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="bg-background/80 sticky top-0 z-10 flex h-14 items-center gap-3 border-b px-4 backdrop-blur md:px-6">
          <nav aria-label="Breadcrumb" className="text-muted-foreground hidden text-sm sm:block">
            Acme Inc. <span className="mx-1">/</span>
            <span className="text-foreground font-medium">Dashboard</span>
          </nav>
          <label className="relative ml-auto w-full max-w-xs">
            <span className="sr-only">Search orders</span>
            <HugeiconsIcon
              icon={Search01Icon}
              size={16}
              className="text-muted-foreground absolute top-1/2 left-2.5 -translate-y-1/2"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search orders…"
              className="bg-background h-9 w-full rounded-md border pr-3 pl-8 text-sm shadow-xs outline-none focus:ring-2 focus:ring-ring/40"
            />
          </label>
          <IconButton label="Notifications">
            <HugeiconsIcon icon={Notification01Icon} size={18} />
          </IconButton>
          <IconButton label={dark ? 'Light theme' : 'Dark theme'} onClick={() => setDark((d) => !d)}>
            <HugeiconsIcon icon={dark ? Sun01Icon : Moon02Icon} size={18} />
          </IconButton>
          <button
            type="button"
            onClick={() => setDialog(true)}
            aria-label="New invoice"
            className="bg-primary text-primary-foreground inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md px-3 text-sm font-medium hover:opacity-90"
          >
            <HugeiconsIcon icon={Add01Icon} size={16} />
            <span className="hidden sm:inline">New invoice</span>
          </button>
        </header>

        <main className="flex-1 space-y-4 p-4 md:p-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
              <p className="text-muted-foreground text-sm">
                Here’s what’s happening with your store today.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setToast('Report exported as CSV')}
              className="hover:bg-accent inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium shadow-xs"
            >
              <HugeiconsIcon icon={Download01Icon} size={16} />
              Export
            </button>
          </div>

          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Key metrics">
            {KPIS.map((k, i) => (
              <Card key={k.label} className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-muted-foreground text-sm font-medium">{k.label}</p>
                  <Sparkline data={k.data} color={`var(--chart-${i + 1})`} />
                </div>
                <div className="mt-1">
                  <div>
                    <p className="text-2xl font-semibold tabular-nums">{k.value}</p>
                    <p
                      className={`mt-1 inline-flex items-center gap-0.5 text-xs font-medium ${
                        (k.label === 'Churn rate' ? k.delta < 0 : k.delta > 0)
                          ? 'text-success'
                          : 'text-danger'
                      }`}
                    >
                      <HugeiconsIcon
                        icon={k.delta > 0 ? ArrowUpRight01Icon : ArrowDownRight01Icon}
                        size={14}
                      />
                      {k.delta > 0 ? '+' : ''}
                      {k.delta}% from last month
                    </p>
                  </div>
                </div>
              </Card>
            ))}
          </section>

          <section className="grid gap-4 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardHeader
                title="Revenue"
                description={`This period vs the previous ${RANGES[range]} days`}
                action={
                  <div role="tablist" aria-label="Range" className="bg-muted flex rounded-lg p-1">
                    {(Object.keys(RANGES) as Range[]).map((r) => (
                      <button
                        key={r}
                        role="tab"
                        aria-selected={range === r}
                        onClick={() => setRange(r)}
                        className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
                          range === r ? 'bg-background shadow-sm' : 'text-muted-foreground'
                        }`}
                      >
                        {r === '7d' ? '7 days' : r === '30d' ? '30 days' : '3 months'}
                      </button>
                    ))}
                  </div>
                }
              />
              <AreaChart days={RANGES[range]} />
            </Card>
            <Card>
              <CardHeader title="Traffic sources" description="Share of sessions, October" />
              <Donut />
            </Card>
          </section>

          <section className="grid gap-4 xl:grid-cols-3">
            <Card>
              <CardHeader title="Sales by month" description="Gross sales, 2026" />
              <BarChart />
            </Card>
            <Card className="xl:col-span-2">
              <CardHeader
                title="Recent orders"
                description={
                  selected.size
                    ? `${selected.size} selected`
                    : `${query ? filtered.length : Math.min(6, orders.length)} of ${orders.length} orders`
                }
              />
              <OrdersTable
                orders={query ? filtered : filtered.slice(0, 6)}
                selected={selected}
                onToggle={(id) =>
                  setSelected((s) => {
                    const n = new Set(s);
                    if (n.has(id)) n.delete(id);
                    else n.add(id);
                    return n;
                  })
                }
              />
            </Card>
          </section>
        </main>
      </div>

      {dialog && (
        <InvoiceDialog
          onClose={() => setDialog(false)}
          onCreate={(o) => {
            setOrders((list) => [o, ...list]);
            setDialog(false);
            setToast(`Invoice ${o.id} created for ${o.name}`);
          }}
          nextId={`INV-${1042 + orders.length * 7}`}
        />
      )}
      {toast && (
        <div
          role="status"
          className="bg-card fixed right-4 bottom-4 z-50 flex items-center gap-2 rounded-lg border px-4 py-3 text-sm font-medium shadow-lg"
        >
          <HugeiconsIcon icon={CheckmarkCircle02Icon} size={18} className="text-success" />
          {toast}
        </div>
      )}
    </div>
  );
}

function Sidebar() {
  const items = [
    { icon: DashboardSquare01Icon, label: 'Dashboard', active: true },
    { icon: Analytics01Icon, label: 'Analytics' },
    { icon: UserGroupIcon, label: 'Customers' },
    { icon: PackageIcon, label: 'Products' },
    { icon: Invoice01Icon, label: 'Invoices' },
    { icon: Settings02Icon, label: 'Settings' },
  ];
  return (
    <aside className="bg-muted/40 sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r p-3 lg:flex">
      <div className="flex items-center gap-2 px-2 py-2">
        <span className="bg-primary text-primary-foreground grid size-8 place-items-center rounded-lg text-sm font-bold">
          A
        </span>
        <div className="leading-tight">
          <p className="text-sm font-semibold">Acme Inc.</p>
          <p className="text-muted-foreground text-xs">Enterprise</p>
        </div>
      </div>
      <nav aria-label="Sidebar" className="mt-4 space-y-0.5">
        {items.map((it) => (
          <a
            key={it.label}
            href="#"
            onClick={(e) => e.preventDefault()}
            aria-current={it.active ? 'page' : undefined}
            className={`flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium ${
              it.active ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent'
            }`}
          >
            <HugeiconsIcon icon={it.icon} size={18} />
            {it.label}
          </a>
        ))}
      </nav>
      <div className="mt-auto flex items-center gap-2 rounded-lg border p-2">
        <span className="bg-primary text-primary-foreground grid size-8 place-items-center rounded-full text-xs font-bold">
          JD
        </span>
        <div className="min-w-0 leading-tight">
          <p className="truncate text-sm font-medium">Jamie Doe</p>
          <p className="text-muted-foreground truncate text-xs">jamie@example.com</p>
        </div>
      </div>
    </aside>
  );
}

function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`bg-card rounded-xl border shadow-xs ${className}`}>{children}</div>;
}
function CardHeader({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 p-5 pb-2">
      <div>
        <h2 className="font-semibold">{title}</h2>
        <p className="text-muted-foreground text-sm">{description}</p>
      </div>
      {action}
    </div>
  );
}
function IconButton({
  label,
  children,
  onClick,
}: {
  label: string;
  children: ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="hover:bg-accent grid size-9 shrink-0 place-items-center rounded-md"
    >
      {children}
    </button>
  );
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
  const max = Math.max(...data);
  const min = Math.min(...data);
  const pts = data
    .map((v, i) => `${(i / (data.length - 1)) * 80},${28 - ((v - min) / (max - min || 1)) * 24}`)
    .join(' ');
  return (
    <svg viewBox="0 0 80 30" className="h-8 w-20 shrink-0" aria-hidden="true">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

const W = 640;
const H = 220;
function AreaChart({ days }: { days: number }) {
  const cur = useMemo(() => series(days, 13 + days, 1600, 700, 18), [days]);
  const prev = useMemo(() => series(days, 29 + days, 1400, 600, 10), [days]);
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...cur, ...prev) * 1.1;
  const x = (i: number) => (i / (days - 1)) * W;
  const y = (v: number) => H - (v / max) * H;
  const line = (d: number[]) => d.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join('');
  const area = (d: number[]) => `${line(d)}L${W},${H}L0,${H}Z`;
  const total = cur.reduce((a, b) => a + b, 0);
  return (
    <div className="px-5 pb-5">
      <p className="text-3xl font-semibold tabular-nums">{money(total)}</p>
      <div className="relative mt-3">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-56 w-full overflow-visible"
          preserveAspectRatio="none"
          role="img"
          aria-label={`Revenue over the last ${days} days`}
          onMouseLeave={() => setHover(null)}
          onMouseMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setHover(Math.round(((e.clientX - r.left) / r.width) * (days - 1)));
          }}
        >
          <defs>
            <linearGradient id="g1" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="var(--chart-1)" stopOpacity="0.35" />
              <stop offset="1" stopColor="var(--chart-1)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0.25, 0.5, 0.75].map((f) => (
            <line key={f} x1="0" x2={W} y1={H * f} y2={H * f} stroke="var(--border)" />
          ))}
          <path d={area(cur)} fill="url(#g1)" />
          <path
            d={line(prev)}
            fill="none"
            stroke="var(--chart-2)"
            strokeWidth="2"
            strokeDasharray="5 5"
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={line(cur)}
            fill="none"
            stroke="var(--chart-1)"
            strokeWidth="2.5"
            vectorEffect="non-scaling-stroke"
          />
          {hover !== null && (
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1="0"
              y2={H}
              stroke="var(--muted-foreground)"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
        {hover !== null && (
          <div
            className="bg-card pointer-events-none absolute top-2 rounded-lg border px-3 py-2 text-xs shadow-md"
            style={{
              left: `${(hover / (days - 1)) * 100}%`,
              transform: `translateX(${hover > days / 2 ? '-110%' : '10%'})`,
            }}
          >
            <p className="font-medium">Day {hover + 1}</p>
            <p className="flex items-center gap-1.5">
              <span className="bg-chart-1 size-2 rounded-full" /> This period{' '}
              <b className="tabular-nums">{money(cur[hover]!)}</b>
            </p>
            <p className="flex items-center gap-1.5">
              <span className="bg-chart-2 size-2 rounded-full" /> Previous{' '}
              <b className="tabular-nums">{money(prev[hover]!)}</b>
            </p>
          </div>
        )}
      </div>
      <div className="text-muted-foreground mt-3 flex gap-4 text-xs">
        <span className="flex items-center gap-1.5">
          <span className="bg-chart-1 size-2 rounded-full" /> This period
        </span>
        <span className="flex items-center gap-1.5">
          <span className="bg-chart-2 size-2 rounded-full" /> Previous period
        </span>
      </div>
    </div>
  );
}

function Donut() {
  const [active, setActive] = useState<number | null>(null);
  const r = 60;
  const c = 2 * Math.PI * r;
  let offset = 0;
  const shown = active === null ? null : SOURCES[active]!;
  return (
    <div className="flex flex-col items-center gap-4 p-5 pt-2">
      <div className="relative">
        <svg viewBox="0 0 160 160" className="size-44 -rotate-90" aria-hidden="true">
          {SOURCES.map((s, i) => {
            const len = (s.value / 100) * c;
            const el = (
              <circle
                key={s.label}
                cx="80"
                cy="80"
                r={r}
                fill="none"
                stroke={s.color}
                strokeWidth={active === i ? 22 : 18}
                strokeDasharray={`${len - 2} ${c - len + 2}`}
                strokeDashoffset={-offset}
                className="transition-[stroke-width] duration-200"
                onMouseEnter={() => setActive(i)}
                onMouseLeave={() => setActive(null)}
              />
            );
            offset += len;
            return el;
          })}
        </svg>
        <div className="absolute inset-0 grid place-content-center text-center">
          <p className="text-2xl font-semibold tabular-nums">{shown ? `${shown.value}%` : '24.8k'}</p>
          <p className="text-muted-foreground text-xs">{shown ? shown.label : 'Sessions'}</p>
        </div>
      </div>
      <ul className="grid w-full grid-cols-2 gap-2 text-sm">
        {SOURCES.map((s, i) => (
          <li key={s.label}>
            <button
              type="button"
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
              className="hover:bg-accent flex w-full items-center gap-2 rounded-md px-2 py-1 text-left"
            >
              <span className="size-2.5 rounded-sm" style={{ background: s.color }} />
              <span className="flex-1">{s.label}</span>
              <span className="text-muted-foreground tabular-nums">{s.value}%</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function BarChart() {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...SALES);
  return (
    <div className="px-5 pb-5">
      <p className="text-3xl font-semibold tabular-nums">
        {money(hover === null ? SALES.reduce((a, b) => a + b, 0) : SALES[hover]!)}
      </p>
      <p className="text-muted-foreground text-xs">{hover === null ? 'Total' : MONTHS[hover]}</p>
      <div className="mt-4 flex h-44 items-end gap-1.5" onMouseLeave={() => setHover(null)}>
        {SALES.map((v, i) => (
          <div key={i} className="flex h-full flex-1 flex-col justify-end gap-1">
            <div
              onMouseEnter={() => setHover(i)}
              className="rounded-t-md transition-[filter]"
              style={{
                height: `${(v / max) * 100}%`,
                background: 'var(--chart-1)',
                filter: hover !== null && hover !== i ? 'saturate(0.3) opacity(0.5)' : 'none',
              }}
            />
            <span className="text-muted-foreground text-center text-[10px]">{MONTHS[i]![0]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const BADGE: Record<Order['status'], string> = {
  Paid: 'bg-success/15 text-success',
  Pending: 'bg-chart-3/20 text-foreground',
  Refunded: 'bg-danger/15 text-danger',
};
function OrdersTable({
  orders,
  selected,
  onToggle,
}: {
  orders: Order[];
  selected: Set<string>;
  onToggle: (id: string) => void;
}) {
  return (
    <div className="overflow-x-auto px-2 pb-3">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-muted-foreground border-b text-left">
            <th className="w-10 px-3 py-2 font-medium">
              <span className="sr-only">Select</span>
            </th>
            <th className="px-3 py-2 font-medium">Customer</th>
            <th className="hidden px-3 py-2 font-medium md:table-cell">Invoice</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="hidden px-3 py-2 font-medium sm:table-cell">Date</th>
            <th className="px-3 py-2 text-right font-medium">Amount</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr
              key={o.id}
              onClick={() => onToggle(o.id)}
              className={`cursor-pointer border-b last:border-0 ${
                selected.has(o.id) ? 'bg-accent' : 'hover:bg-muted/60'
              }`}
            >
              <td className="px-3 py-2.5">
                <input
                  type="checkbox"
                  checked={selected.has(o.id)}
                  onChange={() => onToggle(o.id)}
                  onClick={(e) => e.stopPropagation()}
                  aria-label={`Select ${o.name}`}
                  className="accent-primary size-4"
                />
              </td>
              <td className="px-3 py-2.5">
                <p className="font-medium">{o.name}</p>
                <p className="text-muted-foreground text-xs">{o.email}</p>
              </td>
              <td className="hidden px-3 py-2.5 font-mono text-xs md:table-cell">{o.id}</td>
              <td className="px-3 py-2.5">
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${BADGE[o.status]}`}>
                  {o.status}
                </span>
              </td>
              <td className="text-muted-foreground hidden px-3 py-2.5 sm:table-cell">{o.date}</td>
              <td className="px-3 py-2.5 text-right font-medium tabular-nums">{money(o.amount)}</td>
            </tr>
          ))}
          {orders.length === 0 && (
            <tr>
              <td colSpan={6} className="text-muted-foreground px-3 py-10 text-center">
                No orders match your search.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function InvoiceDialog({
  onClose,
  onCreate,
  nextId,
}: {
  onClose: () => void;
  onCreate: (o: Order) => void;
  nextId: string;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [amount, setAmount] = useState('');
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const field =
    'bg-background mt-1.5 h-9 w-full rounded-md border px-3 text-sm shadow-xs outline-none focus:ring-2 focus:ring-ring/40';
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/50 p-4" onClick={onClose}>
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="invoice-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          onCreate({
            id: nextId,
            name: name.trim() || 'New customer',
            email: email.trim() || 'customer@example.com',
            status: 'Pending',
            amount: Math.max(0, Math.round(Number(amount) || 0)),
            date: 'Oct 18, 2026',
          });
        }}
        className="bg-card w-full max-w-md rounded-xl border p-6 shadow-xl"
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 id="invoice-title" className="text-lg font-semibold">
              New invoice
            </h2>
            <p className="text-muted-foreground text-sm">Bill a customer for an order.</p>
          </div>
          <IconButton label="Close" onClick={onClose}>
            <HugeiconsIcon icon={Cancel01Icon} size={18} />
          </IconButton>
        </div>
        <div className="mt-5 space-y-4">
          <label className="block text-sm font-medium">
            Customer name
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className={field} placeholder="Jane Cooper" />
          </label>
          <label className="block text-sm font-medium">
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={field} placeholder="jane@example.com" />
          </label>
          <label className="block text-sm font-medium">
            Amount (USD)
            <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={field} placeholder="250" />
          </label>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="hover:bg-accent h-9 rounded-md border px-4 text-sm font-medium">
            Cancel
          </button>
          <button type="submit" className="bg-primary text-primary-foreground h-9 rounded-md px-4 text-sm font-medium hover:opacity-90">
            Create invoice
          </button>
        </div>
      </form>
    </div>
  );
}
