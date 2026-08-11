export const typeDefs = `#graphql
  type MacroTotals {
    calories: Int!
    proteinG: Float!
    carbsG:   Float!
    fatG:     Float!
  }

  # ---- Chart Data Types ----

  type WeightDataPoint {
    date:       String!
    rawWeight:  Float!
    emaWeight:  Float!
  }

  type CalorieDataPoint {
    date:     String!
    calories: Int!
    target:   Int!
  }

  type MacroBreakdown {
    protein: Float!
    carbs:   Float!
    fat:     Float!
  }

  type DashboardCharts {
    weightTrend:    [WeightDataPoint!]!
    dailyCalories:  [CalorieDataPoint!]!
    macroBreakdown: MacroBreakdown!
  }

  type DashboardSummary {
    todayWorkouts:         Int!
    lastNightSleepMinutes: Int
    macros:                MacroTotals!
    currentWeightEma:      Float
    charts:                DashboardCharts!
  }

  type Query {
    getDashboardSummary(rangeDays: Int): DashboardSummary!
  }
`;
