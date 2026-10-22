import { useState } from "react";
import { MoreHorizontal, Gauge, LoaderCircle } from "lucide-react";
import { t } from "@/i18n";
import { isPathActive, pathKey } from "@/services/familyPath";
import { useFamilyPaths } from "./FamilyPathProvider";

export function FamilyPathMenu({ collapsed }: { collapsed: boolean }) {
  const { sites, trigger, pending, errors } = useFamilyPaths();
  const [submitted, setSubmitted] = useState(false);
  const enabledSites = sites.filter(s => s.can_trigger && s.paths.length);
  if (!enabledSites.length) return null;
  const busy = enabledSites.some(s => pending.has(pathKey(s.base, "")) || s.paths.some(isPathActive));
  const error = enabledSites.map(s => errors[pathKey(s.base, "")]).filter(Boolean).join(" · ");
  return <details className="family-more" key={String(collapsed)}>
    <summary className="control-button grid h-9 w-9 place-items-center" tabIndex={collapsed ? -1 : undefined} aria-label={t("family.more")} title={t("family.more")}><MoreHorizontal size={17} /></summary>
    <div className="family-more-menu">
      <button type="button" className="control-button family-all" disabled={busy} tabIndex={collapsed ? -1 : undefined} onClick={() => { setSubmitted(true); void Promise.all(enabledSites.map(s => trigger(s.base))); }}>
        {busy ? <LoaderCircle size={16} className="family-spin" /> : <Gauge size={16} />}{t("family.testAll")}
      </button>
      {(submitted || busy) && <span className={error ? "family-error" : ""} role="status">{error || t(busy ? "family.queued" : "family.complete")}</span>}
    </div>
  </details>;
}
