import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type FC,
  type ReactNode,
} from "react";
import {
  normalizeProgrammeSelection,
  type ProgrammeSelection,
  getAllProgrammes,
} from "@/lib/programme-access";
import { fetchAndCacheProgrammes, invalidateProgrammesCache, getDynamicProgrammes } from "@/lib/dynamic-programmes";

const DEFAULT_STORAGE_KEY = "dashboard-shared-programme-selection";

interface ProgrammeContextValue {
  selection: ProgrammeSelection;
  setSelection: (nextSelection: string) => void;
  /** All known programmes (dynamic from DB) */
  programmes: string[];
  /** Whether the dynamic programme list has been fetched */
  programmesLoaded: boolean;
  /** Force re-fetch programmes from server */
  refreshProgrammes: () => Promise<void>;
}

const ProgrammeContext = createContext<ProgrammeContextValue | undefined>(
  undefined,
);

const normalizeStoredSelection = (value: unknown): ProgrammeSelection =>
  normalizeProgrammeSelection(value);

export const ProgrammeProvider: FC<{ children: ReactNode }> = ({
  children,
}) => {
  const [selection, setSelectionState] = useState<ProgrammeSelection>(() => {
    if (typeof window === "undefined") return "";
    return normalizeStoredSelection(
      window.localStorage.getItem(DEFAULT_STORAGE_KEY),
    );
  });

  const [programmes, setProgrammes] = useState<string[]>(() => getDynamicProgrammes());
  const [programmesLoaded, setProgrammesLoaded] = useState(false);

  // Fetch dynamic programmes on mount
  const refreshProgrammes = useCallback(async () => {
    try {
      const fetched = await fetchAndCacheProgrammes();
      setProgrammes([...fetched]);
      setProgrammesLoaded(true);
    } catch {
      // Keep fallback programmes
      setProgrammesLoaded(true);
    }
  }, []);

  useEffect(() => {
    void refreshProgrammes();
  }, [refreshProgrammes]);

  // Periodically refresh programmes every 10 minutes
  useEffect(() => {
    const interval = setInterval(() => {
      void refreshProgrammes();
    }, 10 * 60 * 1000);
    return () => clearInterval(interval);
  }, [refreshProgrammes]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    if (selection) {
      window.localStorage.setItem(DEFAULT_STORAGE_KEY, selection);
      return;
    }

    window.localStorage.removeItem(DEFAULT_STORAGE_KEY);
  }, [selection]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== DEFAULT_STORAGE_KEY) return;
      setSelectionState(normalizeStoredSelection(event.newValue));
    };

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  return (
    <ProgrammeContext.Provider
      value={{
        selection,
        setSelection: (nextSelection) => {
          setSelectionState(normalizeStoredSelection(nextSelection));
        },
        programmes,
        programmesLoaded,
        refreshProgrammes,
      }}
    >
      {children}
    </ProgrammeContext.Provider>
  );
};

export const useProgrammeContext = (): ProgrammeContextValue => {
  const context = useContext(ProgrammeContext);
  if (!context) {
    throw new Error(
      "useProgrammeContext must be used within a ProgrammeProvider",
    );
  }
  return context;
};