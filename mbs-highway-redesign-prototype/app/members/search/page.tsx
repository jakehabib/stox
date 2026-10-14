'use client';

import { GlobalSearch } from '@/components/shell/AppShell';
import { PageHeader } from '@/components/ui';

export default function SearchPage() {
  return (
    <div>
      <PageHeader title="Search" subtitle="Search for tools & resources" />
      <GlobalSearch className="max-w-xl" />
    </div>
  );
}
