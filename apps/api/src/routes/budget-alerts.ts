import { Router } from "express";
import { z } from "zod";
import { BudgetAlert } from "../models/budget-alert.model.js";
import { authenticate } from "../middleware/authenticate.js";
import { requirePermission } from "../middleware/authorize.js";
import { asyncHandler } from "../utils/async-handler.js";
import type { AuthContext } from "../auth/types.js";
import { evaluateBudgetAlerts } from "../costs/budget-alerts.js";
import { tenantBudgetAlertFilter } from "../costs/budget-alert-policy.js";

export const budgetAlertsRouter = Router();
budgetAlertsRouter.use(authenticate);

budgetAlertsRouter.get("/", requirePermission("budgets:read"), asyncHandler(async (req, res) => {
  const auth = res.locals.auth as AuthContext;
  const limit = z.coerce.number().int().min(1).max(100).default(50).parse(req.query.limit ?? 50);
  const evaluation = await evaluateBudgetAlerts(auth.tenantId);
  const [data, unreadCount] = await Promise.all([
    BudgetAlert.find(tenantBudgetAlertFilter(auth.tenantId)).sort({ createdAt: -1 }).limit(limit).lean(),
    BudgetAlert.countDocuments({ tenantId: auth.tenantId, readAt: null })
  ]);
  res.json({ data, meta: { unreadCount, sampleSaturated: evaluation.sampled, createdDuringRead: evaluation.created } });
}));

budgetAlertsRouter.patch("/:alertId/read", requirePermission("budgets:read"), asyncHandler(async (req, res) => {
  const auth = res.locals.auth as AuthContext;
  const alertId = z.string().regex(/^[a-f\d]{24}$/i).parse(req.params.alertId);
  const alert = await BudgetAlert.findOneAndUpdate(
    tenantBudgetAlertFilter(auth.tenantId, alertId),
    { $set: { readAt: new Date() } },
    { new: true }
  ).lean();
  if (!alert) {
    res.status(404).json({ error: { code: "BUDGET_ALERT_NOT_FOUND", message: "Budget alert was not found." } });
    return;
  }
  res.json({ data: alert });
}));
