import { Canvas, Path, Skia } from "@shopify/react-native-skia";
import React from "react";
import { StyleSheet, View } from "react-native";

export type CategoryDonutItem = {
  key: string;
  label: string;
  value: number;
};

type Props = {
  data: CategoryDonutItem[];
  size?: number;
  strokeWidth?: number;
};

const DONUT_COLORS = [
  "#FFB35A",
  "#f1ff30",
  "#28A745",
  "#3094ff",
  "rgba(255,255,255,0.38)",
];

export function getCategoryDonutColor(index: number) {
  return DONUT_COLORS[index] ?? "rgba(255,255,255,0.30)";
}

export function CategoryDonutChart({
  data,
  size = 58,
  strokeWidth = 12,
}: Props) {
  const total = data.reduce((sum, item) => sum + item.value, 0);

  if (total <= 0) {
    return React.createElement(View, {
      style: [
        styles.emptyDonut,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: strokeWidth,
        },
      ],
    });
  }

  const rect = Skia.XYWHRect(
    strokeWidth / 2,
    strokeWidth / 2,
    size - strokeWidth,
    size - strokeWidth,
  );

  let startAngle = -90;

  const canvasChildren = data.map((item, index) => {
    const sweepAngle = (item.value / total) * 360;
    const path = Skia.Path.Make();

    path.addArc(rect, startAngle, sweepAngle);
    startAngle += sweepAngle;

    return React.createElement(Path, {
      key: item.key,
      path: path,
      color: getCategoryDonutColor(index),
      style: "stroke",
      strokeWidth: strokeWidth,
      strokeCap: "round",
    });
  });

  return React.createElement(
    Canvas,
    { style: { width: size, height: size } },
    ...canvasChildren,
  );
}

const styles = StyleSheet.create({
  emptyDonut: {
    borderColor: "rgba(255,255,255,0.08)",
  },
});
