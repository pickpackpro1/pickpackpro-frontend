const MAX_FILE_BATCH_LOOKUPS = 250;

const toArray = (value) => {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.files)) return value.files;
  if (Array.isArray(value?.data?.files)) return value.data.files;
  if (Array.isArray(value?.data)) return value.data;
  return [];
};

export const isUuidValue = (value = '') =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim());

export const normalizeFileBatchResult = (payload = {}) => {
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : payload || {};
  return {
    files: toArray(data.files || payload?.files),
    filesByEntity: data.filesByEntity || data.files_by_entity || {},
    entityFiles: toArray(data.entityFiles || data.entity_files),
    filesById: data.filesById || data.files_by_id || {},
    total: Number(data.total || 0),
  };
};

const dedupeEntities = (entities = []) => {
  const seen = new Set();

  return entities
    .map(({ entityType, entityId }) => ({
      entityType: String(entityType || '').trim().toLowerCase(),
      entityId: String(entityId || '').trim(),
    }))
    .filter(({ entityType, entityId }) => entityType && isUuidValue(entityId))
    .filter(({ entityType, entityId }) => {
      const key = `${entityType}:${entityId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

const dedupeFileIds = (fileIds = []) => {
  const seen = new Set();

  return fileIds
    .map((fileId) => String(fileId || '').trim())
    .filter(isUuidValue)
    .filter((fileId) => {
      if (seen.has(fileId)) return false;
      seen.add(fileId);
      return true;
    });
};

const chunkLookups = (entities = [], fileIds = []) => {
  const lookups = [
    ...entities.map((entity) => ({ type: 'entity', value: entity })),
    ...fileIds.map((fileId) => ({ type: 'fileId', value: fileId })),
  ];
  const chunks = [];

  for (let index = 0; index < lookups.length; index += MAX_FILE_BATCH_LOOKUPS) {
    chunks.push(lookups.slice(index, index + MAX_FILE_BATCH_LOOKUPS));
  }

  return chunks;
};

const mergeBatchResults = (results = []) => ({
  files: results.flatMap((result) => result.files || []),
  filesByEntity: Object.assign({}, ...results.map((result) => result.filesByEntity || {})),
  entityFiles: results.flatMap((result) => result.entityFiles || []),
  filesById: Object.assign({}, ...results.map((result) => result.filesById || {})),
  total: results.reduce((sum, result) => sum + Number(result.total || 0), 0),
});

export const fetchFilesBatch = async ({
  apiBaseUrl = '',
  headers = {},
  parseResponse,
  entities = [],
  fileIds = [],
  fetchOptions = {},
} = {}) => {
  if (typeof parseResponse !== 'function') {
    throw new Error('parseResponse is required for batch file requests.');
  }

  const cleanEntities = dedupeEntities(entities);
  const cleanFileIds = dedupeFileIds(fileIds);
  const chunks = chunkLookups(cleanEntities, cleanFileIds);

  if (!chunks.length) {
    return normalizeFileBatchResult({});
  }

  const results = [];

  for (const chunk of chunks) {
    const params = new URLSearchParams();
    chunk.forEach((lookup) => {
      if (lookup.type === 'entity') {
        params.append('entity', `${lookup.value.entityType}:${lookup.value.entityId}`);
      } else {
        params.append('fileId', lookup.value);
      }
    });

    const response = await fetch(`${apiBaseUrl}/api/files/batch?${params.toString()}`, {
      method: 'GET',
      headers,
      cache: 'no-store',
      ...fetchOptions,
    });
    results.push(normalizeFileBatchResult(await parseResponse(response)));
  }

  return mergeBatchResults(results);
};

export const getBatchFilesForEntity = (batch = {}, entityType = '', entityId = '') => {
  const normalizedType = String(entityType || '').trim().toLowerCase();
  const normalizedId = String(entityId || '').trim();
  if (!normalizedType || !normalizedId) return [];

  const directKey = `${normalizedType}:${normalizedId}`;
  return (
    batch.filesByEntity?.[directKey] ||
    batch.filesByEntity?.[`${entityType}:${normalizedId}`] ||
    batch.entityFiles?.find((entry) => String(entry?.key || '').toLowerCase() === directKey.toLowerCase())?.files ||
    []
  );
};

export const getBatchFileById = (batch = {}, fileId = '') => {
  const normalizedFileId = String(fileId || '').trim();
  if (!normalizedFileId) return null;
  return batch.filesById?.[normalizedFileId] || batch.files?.find((file) => {
    const id = file?.id || file?.uuid || file?.fileId || file?.file_id;
    return String(id || '').trim() === normalizedFileId;
  }) || null;
};
