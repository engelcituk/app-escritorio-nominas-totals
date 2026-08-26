export interface CatalogStatus {
  state: 'UNCONFIGURED' | 'AUTH_REQUIRED' | 'FIRST_SYNC_REQUIRED' | 'SYNCING' | 'READY_ONLINE' | 'READY_OFFLINE' | 'DEGRADED' | 'CATALOG_EXPIRED';
  revision: number | null; checksum: string | null; syncedAt: string | null; validUntil: string | null;
  busy: boolean; canProcess: boolean; canSynchronize: boolean; message: string;
  errorCode: string | null; retryAt: number | null; legacyCount: number; conflictCount: number;
}
export interface CatalogEntry {
  id: number; uuid: string | null; code: string; name: string; active: boolean;
  mappingStatus: 'MAPPED' | 'LEGACY_UNMAPPED'; revision: number | null;
  groupName: string | null; operationFactor: number | null; aliasCount: number;
}
export interface CatalogAliasEntry { id: number; uuid: string | null; sourceDescription: string; normalizedDescription: string; active: boolean }
export interface CatalogConflict { id: number; entityType: string; localId: number; code: string | null; conflictType: string; description: string; revision: number | null }
export interface CatalogPage<T> { items: T[]; total: number }
export interface CatalogQuery { entity: 'concepts' | 'groups' | 'types'; page: number; pageSize: number; search: string; filter: 'all' | 'active' | 'inactive' | 'legacy' }
