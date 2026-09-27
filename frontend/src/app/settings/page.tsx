import { SectionHeader } from "@/components/design-system/SectionHeader";
import { DataControls } from "@/features/backup/DataControls";

/**
 * Settings route — M2 ships the Data controls section: backup export,
 * validated import (merge/replace), and the scoped cleanup operations.
 * More settings sections arrive with later milestones.
 */
export default function SettingsPage() {
  return (
    <div className="flex flex-col gap-8 px-6 py-6">
      <h1 className="sr-only">Settings</h1>

      <section>
        <SectionHeader title="Data controls" />
        <p className="mb-6 max-w-2xl text-body-lg font-regular text-mist">
          Everything below stays on this device. Export a backup before clearing site data or
          switching browsers.
        </p>
        <DataControls />
      </section>
    </div>
  );
}
