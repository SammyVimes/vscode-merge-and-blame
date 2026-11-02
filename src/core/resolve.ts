// Copyright 2000-2026 JetBrains s.r.o. and contributors.
// Licensed under Apache-2.0. See LICENSE and NOTICE.
// ComparisonMergeUtil.tryResolveConflict uses the simple text resolver in the
// pinned sources and installed reference IDE. Keep the same runtime entry point.
export { resolveTextConflict as resolveSimple } from './simpleResolve';
