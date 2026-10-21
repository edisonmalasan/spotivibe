import { SectionHeader } from "@/components/design-system/SectionHeader";
import { DataControls } from "@/features/backup/DataControls";
import { InstallRow } from "@/features/pwa/UpdateNotice";
import { ArtistsSettingsSection } from "@/features/preferences/ArtistsSettingsSection";
import { AutofillSettingsSection } from "@/features/preferences/AutofillSettingsSection";
import { LanguagesSettingsSection } from "@/features/preferences/LanguagesSettingsSection";

/**
 * Settings route — M2 ships the Data controls section: backup export,
 * validated import (merge/replace), and the scoped cleanup operations.
 * M8 adds Languages, which reopens the shared language picker so a first-run
 * choice stays changeable (spec: languages are changeable after onboarding).
 * M10 adds Playback, the one control that gates queue autofill (design §6).
 * M13 adds the install affordance here rather than as a shell banner: installing
 * is a decision someone makes once, so it belongs in the place people already come
 * to change how the app behaves (spec: `pwa` — "Install affordance").
 *
 * **Artists sits beside Languages** because it is the same kind of control: a
 * first-run answer the listener can revise. The first-run surface asks about
 * artists; this one lets them change their mind, exactly as Languages has
 * always allowed for languages.
 */
export default function SettingsPage() {
  return (
    <div className="flex flex-col gap-8 px-6 py-6">
      <h1 className="sr-only">Settings</h1>

      <section>
        <SectionHeader title="Install" />
        <p className="mb-6 max-w-2xl text-body-lg font-regular text-mist">
          Spotivibe can open like an app. Your library, playlists, and history stay available
          without a connection; search and playback need one.
        </p>
        <InstallRow />
      </section>

      <section>
        <SectionHeader title="Languages" />
        <p className="mb-6 max-w-2xl text-body-lg font-regular text-mist">
          Your language choices shape every discovery shelf and stay on this device.
        </p>
        <LanguagesSettingsSection />
      </section>

      <section>
        <SectionHeader title="Artists" />
        <p className="mb-6 max-w-2xl text-body-lg font-regular text-mist">
          The artists you pick lead your Quick Picks. They stay on this device, and you can change
          them whenever you like.
        </p>
        <ArtistsSettingsSection />
      </section>

      <section>
        <SectionHeader title="Playback" />
        <p className="mb-6 max-w-2xl text-body-lg font-regular text-mist">
          Radio is always yours to start. These settings only govern what happens to a queue you
          started yourself.
        </p>
        <AutofillSettingsSection />
      </section>

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
