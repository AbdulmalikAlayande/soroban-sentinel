import { Registry } from "prom-client";

export const register = new Registry();

import { budgetRemainingGauge } from "./metrics/budget.js";
register.registerMetric(budgetRemainingGauge);
