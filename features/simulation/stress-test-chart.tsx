"use client";

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatMoney, formatNumber } from "@/lib/format";

export interface StressDelayPointView {
  label: string;
  contribution: number | null;
}

export interface StressPremiumPointView {
  premiumLabel: string;
  contribution: number | null;
  packs: number;
}

function StressLineChart<T extends { contribution: number | null }>({
  data,
  xKey,
  stroke,
  tooltipFormatter,
}: {
  data: T[];
  xKey: Extract<keyof T, string>;
  stroke: string;
  tooltipFormatter: (value: unknown, payload?: T) => string;
}) {
  return (
    <div className="comparison-chart stress-test-chart" aria-hidden="true">
      <ResponsiveContainer width="100%" height={250} initialDimension={{ width: 300, height: 250 }}>
        <LineChart data={data} margin={{ top: 12, right: 16, bottom: 4, left: 6 }} accessibilityLayer={false}>
          <CartesianGrid vertical={false} stroke="#e2e8e3" />
          <XAxis dataKey={xKey} tickLine={false} axisLine={false} tick={{ fill: "#495e56", fontSize: 12 }} />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={86}
            tick={{ fill: "#495e56", fontSize: 11 }}
            tickFormatter={(value: number) => formatMoney(value)}
          />
          <Tooltip
            formatter={(value, _name, item) =>
              tooltipFormatter(value, (item as { payload?: T } | undefined)?.payload)
            }
          />
          <Line
            type="monotone"
            dataKey="contribution"
            name="Estimasi kontribusi"
            stroke={stroke}
            strokeWidth={2.5}
            dot={{ r: 4, fill: stroke }}
            activeDot={{ r: 6 }}
            connectNulls={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Grafik garis dampak keterlambatan pengiriman (0–5 hari) terhadap kontribusi bersih. */
export function StressDelayChart({ data }: { data: StressDelayPointView[] }) {
  return (
    <StressLineChart
      data={data}
      xKey="label"
      stroke="#19513f"
      tooltipFormatter={(value) => formatMoney(typeof value === "number" ? value : null)}
    />
  );
}

/** Grafik garis sensitivitas premi penawaran alternatif terhadap kontribusi bersih. */
export function StressPremiumChart({ data }: { data: StressPremiumPointView[] }) {
  return (
    <StressLineChart
      data={data}
      xKey="premiumLabel"
      stroke="#3c775f"
      tooltipFormatter={(value, payload) => {
        const money = formatMoney(typeof value === "number" ? value : null);
        return typeof payload?.packs === "number" ? `${money} (${formatNumber(payload.packs)} pak)` : money;
      }}
    />
  );
}
