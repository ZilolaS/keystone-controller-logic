import type { UnifiedControlDesign } from "./design";

export type ControlRouteId =
  | "product-280"
  | "product-mini"
  | "product-nano"
  | "metering"
  | "scheduled-dispatch"
  | "realtime-dispatch"
  | "crd"
  | "soc-policy"
  | "pcs-dispatch"
  | "pv-curtailment"
  | "protection"
  | "generator"
  | "writer-pcs";

export type ControlProductPath = "eSpire280" | "Mini" | "NANO" | "unsupported";

export interface ControlRoute {
  id: ControlRouteId;
  enabled: boolean;
  reason: string;
}

export interface UnifiedControlRoutePlan {
  productPath: ControlProductPath;
  routes: ControlRoute[];
  activeRouteIds: ControlRouteId[];
}

export function buildUnifiedControlRoutePlan(
  design: UnifiedControlDesign
): UnifiedControlRoutePlan {
  const pcsDispatchEnabled =
    design.routing.pcsDispatch !== "none" &&
    design.limits.pcs.source !== "disabled" &&
    (design.limits.pcs.maxChargeKw > 0 || design.limits.pcs.maxDischargeKw > 0);
  const meteringEnabled =
    design.capabilities.hasMeterIntegration ||
    design.metering.calculatedReadings.length > 0;
  const crdEnabled =
    design.policies.crdMode !== "no-restriction" &&
    design.metering.sources.utilityPowerKw !== "not-configured";
  const pvCurtailmentEnabled =
    design.routing.pvCurtailment !== "none" && design.pv.acInverterCount > 0;
  const generatorEnabled = design.routing.generator !== "none";
  const protectionEnabled = design.protection.strategy !== "none";

  const routes: ControlRoute[] = [
    route(
      "product-280",
      design.productLine === "280",
      design.productLine === "280"
        ? "eSpire280 system profile selected"
        : "site is not configured as eSpire280"
    ),
    route(
      "product-mini",
      design.productLine === "Mini",
      design.productLine === "Mini"
        ? "Mini system profile selected"
        : "site is not configured as Mini"
    ),
    route(
      "product-nano",
      design.productLine === "NANO",
      design.productLine === "NANO"
        ? "NANO system profile selected"
        : "site is not configured as NANO"
    ),
    route(
      "metering",
      meteringEnabled,
      meteringEnabled
        ? `metering source configured for ${configuredReadings(design)}`
        : "no metering source or calculation is configured"
    ),
    route(
      "scheduled-dispatch",
      design.policies.scheduledControlEnabled,
      design.policies.scheduledControlEnabled
        ? "scheduled control is enabled"
        : "scheduled control is disabled"
    ),
    route(
      "realtime-dispatch",
      pcsDispatchEnabled,
      pcsDispatchEnabled
        ? "PCS dispatch can accept realtime requests"
        : "PCS dispatch is unavailable"
    ),
    route(
      "crd",
      crdEnabled,
      crdEnabled
        ? `${design.policies.crdMode} uses utility power feedback`
        : "CRD is unrestricted or utility power is unavailable"
    ),
    route(
      "soc-policy",
      pcsDispatchEnabled,
      pcsDispatchEnabled
        ? `battery SOC policy ${design.policies.soc.min}-${design.policies.soc.max} is active`
        : "battery dispatch is disabled"
    ),
    route(
      "pcs-dispatch",
      pcsDispatchEnabled,
      pcsDispatchEnabled
        ? `${design.routing.pcsDispatch} dispatch enabled`
        : "no PCS dispatch path is configured"
    ),
    route(
      "pv-curtailment",
      pvCurtailmentEnabled,
      pvCurtailmentEnabled
        ? `${design.routing.pvCurtailment} PV curtailment enabled`
        : "PV curtailment is disabled or no AC inverter is configured"
    ),
    route(
      "protection",
      protectionEnabled,
      protectionEnabled
        ? `${design.protection.strategy} protection integration enabled`
        : "no islanding protection integration is configured"
    ),
    route(
      "generator",
      generatorEnabled,
      generatorEnabled
        ? `${design.routing.generator} generator control enabled`
        : "generator control is not configured"
    ),
    route(
      "writer-pcs",
      pcsDispatchEnabled,
      pcsDispatchEnabled
        ? "PCS writer output is required"
        : "PCS writer output is disabled"
    ),
  ];

  return {
    productPath: resolveProductPath(design),
    routes,
    activeRouteIds: routes
      .filter((candidate) => candidate.enabled)
      .map((candidate) => candidate.id),
  };
}

function route(
  id: ControlRouteId,
  enabled: boolean,
  reason: string
): ControlRoute {
  return { id, enabled, reason };
}

function resolveProductPath(design: UnifiedControlDesign): ControlProductPath {
  if (design.productLine === "280") return "eSpire280";
  if (design.productLine === "Mini") return "Mini";
  if (design.productLine === "NANO") return "NANO";
  return "unsupported";
}

function configuredReadings(design: UnifiedControlDesign): string {
  const sources = Object.entries(design.metering.sources)
    .filter(([, source]) => source !== "not-configured")
    .map(([reading, source]) => `${reading}:${source}`);

  return sources.length > 0 ? sources.join(", ") : "calculated readings";
}
