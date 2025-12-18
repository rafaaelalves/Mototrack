import { LinearGradient } from "expo-linear-gradient";
import React from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Defs, RadialGradient, Rect, Stop } from "react-native-svg";

export function AppBackground() {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {/* Base roxa */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: "#2B135A" }]} />

      {/* Brilho quente (bem suave) */}
      <Svg style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id="glow" cx="50%" cy="42%" rx="65%" ry="65%">
            <Stop offset="0%" stopColor="#FFB35A" stopOpacity="0.16" />
            <Stop offset="35%" stopColor="#FFB35A" stopOpacity="0.10" />
            <Stop offset="65%" stopColor="#FFB35A" stopOpacity="0.05" />
            <Stop offset="100%" stopColor="#FFB35A" stopOpacity="0" />
          </RadialGradient>
        </Defs>

        {/* Um “tapete” radial, em vez de elipse recortada */}
        <Rect width="100%" height="100%" fill="url(#glow)" />
      </Svg>

      {/* Vignette sutil (escurece bordas / dá profundidade) */}
      <LinearGradient
        colors={["rgba(0,0,0,0.10)", "rgba(0,0,0,0.00)", "rgba(0,0,0,0.18)"]}
        locations={[0, 0.55, 1]}
        style={styles.vignette}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  vignette: {
    ...StyleSheet.absoluteFillObject,
  },
});
