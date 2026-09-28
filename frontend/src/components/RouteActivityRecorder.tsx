// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * Records every route transition into the recent-files log (issues #1525, #1527).
 *
 * The command palette's "recent" section and the offline page's shortcut list
 * both need a reliable record of where the user has been. Putting that in a
 * component means every route would have to opt in; watching `usePathname()`
 * from the shell means it is automatic and cannot drift.
 *
 * Mounted once, inside `WorkspaceProvider` (which owns the wallet), so an entry
 * can be attributed to the connected account and mirrored into the synced
 * workspace history rather than living only in this browser.
 */

"use client";

import React, { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useRecentFiles } from "@/hooks/useRecentFiles";
import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import { routeLabel } from "@/lib/navigation";

export function RouteActivityRecorder() {
  const pathname = usePathname();
  const { record } = useRecentFiles();
  const { recordHistory } = useWorkspace();
  // `usePathname()` also fires for query-only changes; the last path that was
  // logged is tracked explicitly so a hash/query flip does not duplicate an
  // entry (and does not count as "navigation" for the history log).
  const lastPath = useRef<string | null>(null);

  useEffect(() => {
    if (!pathname || pathname === lastPath.current) return;
    const isFirst = lastPath.current === null;
    lastPath.current = pathname;
    // The initial render is the app shell itself, not a deliberate visit.
    if (isFirst) return;

    record({ id: pathname, title: routeLabel(pathname), kind: "route" });
    // Route visits are workspace history, not user-authored notes, so they use
    // the generic `note` kind and stay out of the compile/deploy timelines the
    // template library renders.
    recordHistory({ kind: "note", label: `Visited ${routeLabel(pathname)}` });
  }, [pathname, record, recordHistory]);

  return null;
}

export default RouteActivityRecorder;
