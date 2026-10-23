import {
  MAX_DOWNLOAD_RECORDS,
  type BrowserDownloadEntry,
  type BrowserDownloadsChange,
  type BrowserDownloadsPage,
} from "@/lib/api/browserDownloadsTypes";

/** A bounded renderer projection; history membership always comes from list pages. */
export class BrowserDownloadsProjection {
  readonly #entries = new Map<
    string,
    { entry: BrowserDownloadEntry; revision: number }
  >();
  #eventRevision = 0;
  historyRevision = 0;

  change(change: BrowserDownloadsChange): "stale" | "progress" | "history" {
    if (change.kind === "invalidated") return "history";
    if (
      change.revision <= this.#eventRevision ||
      change.historyRevision < this.historyRevision
    )
      return "stale";
    this.#eventRevision = change.revision;
    const structural = change.historyRevision > this.historyRevision;
    this.historyRevision = change.historyRevision;
    for (const id of change.removedIds) this.#entries.delete(id);
    for (const entry of change.entries) {
      const previous = this.#entries.get(entry.id);
      if (previous && previous.revision >= change.revision) continue;
      this.#put(
        {
          ...entry,
          // Native history checks the filesystem; progress cannot resurrect a deleted file.
          fileExists:
            previous?.entry.state === entry.state
              ? previous.entry.fileExists
              : entry.fileExists,
        },
        change.revision,
      );
    }
    return structural ? "history" : "progress";
  }

  read(page: BrowserDownloadsPage): void {
    this.historyRevision = Math.max(this.historyRevision, page.historyRevision);
    for (const entry of page.entries) {
      const previous = this.#entries.get(entry.id);
      if (previous && previous.revision > page.revision) {
        if (previous.entry.state === entry.state)
          this.#put(
            { ...previous.entry, fileExists: entry.fileExists },
            previous.revision,
          );
      } else this.#put(entry, page.revision);
    }
  }

  project(page: BrowserDownloadsPage): BrowserDownloadsPage {
    return {
      ...page,
      entries: page.entries.map(
        (entry) => this.#entries.get(entry.id)?.entry ?? entry,
      ),
    };
  }

  #put(entry: BrowserDownloadEntry, revision: number): void {
    this.#entries.delete(entry.id);
    this.#entries.set(entry.id, { entry, revision });
    if (this.#entries.size > MAX_DOWNLOAD_RECORDS)
      this.#entries.delete(this.#entries.keys().next().value!);
  }
}
