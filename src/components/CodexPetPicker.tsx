import {
  CircleAlert,
  ExternalLink,
  LoaderCircle,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useI18n } from "../i18n";
import {
  codexPetPageUrl,
  codexPetThumbnailUrl,
  loadCodexPetCatalog,
  type CodexPetCatalogEntry,
} from "../lib/codex-pets";

export function CodexPetPicker({
  disabled,
  onSelect,
}: {
  disabled?: boolean;
  onSelect: (pet: CodexPetCatalogEntry) => Promise<void>;
}) {
  const { locale, t } = useI18n();
  const [open, setOpen] = useState(false);
  const [pets, setPets] = useState<CodexPetCatalogEntry[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectingSlug, setSelectingSlug] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || pets.length > 0) return;
    const controller = new AbortController();
    let cancelled = false;
    setLoading(true);
    setError(null);
    void loadCodexPetCatalog(controller.signal)
      .then((nextPets) => {
        if (!cancelled) setPets(nextPets);
      })
      .catch((caught) => {
        if (cancelled) return;
        if (caught instanceof DOMException && caught.name === "AbortError")
          return;
        setError(t("agents.codexPetLoadFailed"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [open, pets.length, t]);

  const visiblePets = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return pets;
    return pets.filter((pet) =>
      [
        pet.name,
        pet.localizedNames.en,
        pet.localizedNames.zh,
        pet.author,
        pet.category,
      ].some((value) => value?.toLocaleLowerCase().includes(normalized)),
    );
  }, [pets, query]);

  return (
    <>
      <button
        className="project-agent-codex-pet-open"
        disabled={disabled}
        onClick={() => setOpen(true)}
        type="button"
      >
        <Sparkles size={14} />
        {t("agents.chooseCodexPet")}
      </button>
      {open ? (
        <div
          className="dialog-backdrop codex-pet-picker-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !selectingSlug) {
              setOpen(false);
            }
          }}
        >
          <section
            aria-label={t("agents.codexPetPickerTitle")}
            aria-modal="true"
            className="codex-pet-picker"
            role="dialog"
          >
            <header>
              <span>
                <Sparkles aria-hidden="true" size={18} />
                <span>
                  <strong>{t("agents.codexPetPickerTitle")}</strong>
                  <small>{t("agents.codexPetPickerDescription")}</small>
                </span>
              </span>
              <button
                aria-label={t("common.close")}
                disabled={Boolean(selectingSlug)}
                onClick={() => setOpen(false)}
                type="button"
              >
                <X size={18} />
              </button>
            </header>
            <label className="codex-pet-picker-search">
              <Search aria-hidden="true" size={15} />
              <input
                autoFocus
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("agents.codexPetSearch")}
                value={query}
              />
            </label>
            <div className="codex-pet-picker-content">
              {loading ? (
                <p className="codex-pet-picker-state">
                  <LoaderCircle className="spin" size={20} />
                  {t("agents.codexPetLoading")}
                </p>
              ) : error ? (
                <p className="codex-pet-picker-state error" role="alert">
                  <CircleAlert size={18} />
                  {error}
                </p>
              ) : visiblePets.length === 0 ? (
                <p className="codex-pet-picker-state">
                  {t("agents.codexPetEmpty")}
                </p>
              ) : (
                <div className="codex-pet-picker-grid">
                  {visiblePets.map((pet) => {
                    const displayName =
                      pet.localizedNames[locale] ??
                      pet.localizedNames.en ??
                      pet.name;
                    const selecting = selectingSlug === pet.slug;
                    return (
                      <article className="codex-pet-picker-card" key={pet.slug}>
                        <img
                          alt=""
                          loading="lazy"
                          src={codexPetThumbnailUrl(pet.slug)}
                        />
                        <span>
                          <strong>{displayName}</strong>
                          <small>
                            {t("agents.codexPetBy", { author: pet.author })}
                          </small>
                          <small>{pet.category}</small>
                        </span>
                        <button
                          aria-label={t("agents.selectCodexPet", {
                            name: displayName,
                          })}
                          disabled={Boolean(selectingSlug)}
                          onClick={() => {
                            setSelectingSlug(pet.slug);
                            setError(null);
                            void onSelect(pet)
                              .then(() => setOpen(false))
                              .catch(() =>
                                setError(t("agents.codexPetSelectFailed")),
                              )
                              .finally(() => setSelectingSlug(null));
                          }}
                          type="button"
                        >
                          {selecting ? (
                            <LoaderCircle className="spin" size={14} />
                          ) : (
                            t("agents.selectCodexPetAction")
                          )}
                        </button>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
            <footer>
              <span>{t("agents.codexPetLicenseNotice")}</span>
              <a href="https://codexpet.top" rel="noreferrer" target="_blank">
                codexpet.top
                <ExternalLink size={12} />
              </a>
            </footer>
          </section>
        </div>
      ) : null}
    </>
  );
}

export function CodexPetAttribution({
  pet,
}: {
  pet: {
    slug: string;
    name: string;
    author: string;
    license: string;
    spriteVersion: 1 | 2;
  };
}) {
  const { t } = useI18n();
  return (
    <span className="project-agent-codex-pet-attribution">
      <span>
        <strong>{pet.name}</strong>
        <small>
          {t("agents.codexPetAttribution", {
            author: pet.author,
            license: pet.license,
            version: pet.spriteVersion,
          })}
        </small>
      </span>
      <a href={codexPetPageUrl(pet.slug)} rel="noreferrer" target="_blank">
        {t("agents.codexPetViewSource")}
        <ExternalLink size={11} />
      </a>
    </span>
  );
}
