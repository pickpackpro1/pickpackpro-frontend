import { useEffect, useMemo, useRef, useState } from 'react';
import Layout from './adminlayout/Layout';
import LoadingState from '../common/LoadingState';
import FullPageLoader from '../common/FullPageLoader';
import { getSession } from '../../utils/auth';
import { API_MUTATION_EVENT_NAME, showToast } from '../../utils/toast';
import {
  Search,
  Plus,
  Eye,
  Edit3,
  Box,
  Filter,
  RefreshCw,
  Upload,
  Download,
  Trash2,
  X,
} from 'lucide-react';
import {
  getProductActiveStatus,
  getProductDefaultFnskuLabelFile,
  getProductDefaultFnskuLabelFileId,
  getProductDefaultFnskuLabelFileName,
  getProductDefaultFnskuLabelFileUrl,
  getProductDimensionParts,
  getProductDimensionsText,
  getProductFlags,
  getProductWeightText,
  getProductWeightValue,
} from '../../utils/productFields';

const API_BASE_URL = '';
const PRODUCTS_PER_PAGE = 20;

const initialProductForm = {
  clientId: '',
  productName: '',
  sku: '',
  defaultFnsku: '',
  lengthCm: '',
  widthCm: '',
  heightCm: '',
  weightKg: '',
  hazmatFlag: false,
  expiryTracked: false,
  lotTracked: false,
  needsBundling: false,
  bundleSize: '1',
  active: true,
  defaultFnskuLabelFile: null,
  defaultFnskuLabelFileName: '',
  defaultFnskuLabelUploadFile: null,
};

const buildHeaders = (includeJson = false) => {
  const session = getSession();
  const headers = {};

  if (session?.token) {
    headers['Authorization'] = `Bearer ${session.token}`;
  }

  if (includeJson) {
    headers['Content-Type'] = 'application/json';
  }

  return headers;
};

const parseResponse = async (response) => {
  const contentType = response.headers.get('content-type') || '';

  if (!response.ok) {
    const text = await response.text();
    let payload = null;

    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = text;
      }
    }

    const message =
      payload?.message ||
      payload?.error ||
      payload?.details ||
      (typeof payload === 'string' ? payload : '') ||
      `Request failed with status ${response.status}`;

    throw new Error(message);
  }

  if (contentType.includes('application/json')) {
    return response.json();
  }

  return response;
};

const extractProducts = (payload) => {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (Array.isArray(payload?.products)) {
    return payload.products;
  }

  if (Array.isArray(payload?.data?.products)) {
    return payload.data.products;
  }

  if (Array.isArray(payload?.data?.rows)) {
    return payload.data.rows;
  }

  if (Array.isArray(payload?.rows)) {
    return payload.rows;
  }

  if (Array.isArray(payload?.results)) {
    return payload.results;
  }

  if (Array.isArray(payload?.data?.results)) {
    return payload.data.results;
  }

  if (Array.isArray(payload?.data)) {
    return payload.data;
  }

  return [];
};

const extractProductDetail = (payload) => {
  const candidates = [
    payload?.product,
    payload?.data?.product,
    payload?.data?.row,
    payload?.data?.record,
    payload?.row,
    payload?.record,
    payload?.data,
    payload,
  ];

  return (
    candidates.find((candidate) => candidate && typeof candidate === 'object' && !Array.isArray(candidate)) ||
    {}
  );
};

const extractClients = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.clients)) return payload.clients;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.results)) return payload.results;
  return [];
};

const isUuidValue = (value = '') =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || '').trim()
  );

const cleanDisplayValue = (value = '') => {
  const text = String(value || '').trim();
  if (!text || isUuidValue(text)) return '';
  return text;
};

const firstDisplayValue = (...values) =>
  values.map(cleanDisplayValue).find(Boolean) || '';

const getClientId = (client = {}) =>
  client?.id || client?.uuid || client?.clientId || client?.client_id || '';

const getClientName = (client = {}) =>
  firstDisplayValue(
    client?.companyName,
    client?.company_name,
    client?.company,
    client?.businessName,
    client?.business_name,
    client?.name,
    client?.fullName,
    client?.full_name,
    client?.displayName,
    client?.display_name,
    client?.user?.name,
    client?.users?.name
  );

const getClientEmail = (client = {}) =>
  firstDisplayValue(
    client?.email,
    client?.contactEmail,
    client?.contact_email,
    client?.billingEmail,
    client?.billing_email,
    client?.user?.email,
    client?.users?.email,
    client?.profile?.email
  );

const getProductInlineClientName = (product = {}) =>
  firstDisplayValue(
    product?.client?.companyName,
    product?.client?.company_name,
    product?.client?.company,
    product?.client?.businessName,
    product?.client?.business_name,
    product?.client?.name,
    product?.clients?.companyName,
    product?.clients?.company_name,
    product?.clients?.name,
    product?.clientName,
    product?.client_name,
    product?.companyName,
    product?.company_name
  );

const getProductInlineClientEmail = (product = {}) =>
  firstDisplayValue(
    product?.client?.email,
    product?.client?.contactEmail,
    product?.client?.contact_email,
    product?.clients?.email,
    product?.clients?.contactEmail,
    product?.clients?.contact_email,
    product?.clientEmail,
    product?.client_email,
    product?.contactEmail,
    product?.contact_email
  );

const normalizeProduct = (product) => {
  const isActive = getProductActiveStatus(product);
  const dimensions = getProductDimensionParts(product);
  const flags = getProductFlags(product);

  return {
    id: product?.id || product?.uuid || '',
    clientId:
      product?.clientId ||
      product?.client_id ||
      product?.client?.id ||
      product?.client?.uuid ||
      product?.client?.clientId ||
      product?.client?.client_id ||
      product?.clients?.id ||
      product?.clients?.uuid ||
      product?.clients?.clientId ||
      product?.clients?.client_id ||
      '',
    clientName: getProductInlineClientName(product),
    clientEmail: getProductInlineClientEmail(product),
    productName: product?.productName || product?.product_name || product?.name || 'Unnamed Product',
    sku: product?.sku || '',
    defaultFnsku: product?.defaultFnsku || product?.defaultFNSKU || product?.default_fnsku || '',
    defaultFnskuLabelFileId: getProductDefaultFnskuLabelFileId(product),
    defaultFnskuLabelFile: getProductDefaultFnskuLabelFile(product),
    defaultFnskuLabelFileName: getProductDefaultFnskuLabelFileName(product),
    defaultFnskuLabelFileUrl: getProductDefaultFnskuLabelFileUrl(product),
    lengthCm: dimensions.length,
    widthCm: dimensions.width,
    heightCm: dimensions.height,
    dimensionsText: getProductDimensionsText(product),
    weightKg: getProductWeightValue(product),
    weightText: getProductWeightText(product),
    flags,
    hazmatFlag: flags.some((flag) => flag.toLowerCase() === 'hazmat'),
    expiryTracked: Boolean(product?.expiryTracked ?? product?.expiry_tracked),
    lotTracked: Boolean(product?.lotTracked ?? product?.lot_tracked),
    needsBundling: Boolean(product?.needsBundling ?? product?.needs_bundling),
    bundleSize: product?.bundleSize ?? product?.bundle_size ?? '',
    active: isActive,
    status: isActive ? 'Active' : 'Inactive',
  };
};

const toOptionalNumber = (value) => {
  const normalizedValue = String(value ?? '').trim();
  return normalizedValue ? Number(normalizedValue) : undefined;
};

const toPayload = (form, { includeClientId = true, includeSku = true } = {}) => {
  const payload = {
    productName: form.productName.trim(),
    defaultFnsku: form.defaultFnsku.trim(),
    lengthCm: toOptionalNumber(form.lengthCm),
    widthCm: toOptionalNumber(form.widthCm),
    heightCm: toOptionalNumber(form.heightCm),
    weightKg: toOptionalNumber(form.weightKg),
    hazmatFlag: form.hazmatFlag,
    expiryTracked: form.expiryTracked,
    lotTracked: form.lotTracked,
    needsBundling: form.needsBundling,
    bundleSize: form.needsBundling ? Number(form.bundleSize) : null,
    active: form.active,
  };

  if (includeClientId) payload.clientId = form.clientId.trim();
  if (includeSku) payload.sku = form.sku.trim();

  return payload;
};

const normalizeProductIdentityValue = (value = '') => String(value || '').trim().toLowerCase();

const findProductWithSameClientSku = (products = [], form = {}, currentProductId = '') => {
  const clientId = normalizeProductIdentityValue(form.clientId);
  const sku = normalizeProductIdentityValue(form.sku);
  const productId = String(currentProductId || '').trim();

  if (!clientId || !sku) return null;

  return products.find((product) => {
    const currentId = String(product?.id || '').trim();
    if (productId && currentId === productId) return false;

    return (
      normalizeProductIdentityValue(product?.clientId) === clientId &&
      normalizeProductIdentityValue(product?.sku) === sku
    );
  }) || null;
};

const isDuplicateProductSkuError = (message = '') => {
  const normalizedMessage = String(message || '').toLowerCase();
  return Boolean(
    normalizedMessage.includes('unique constraint') &&
      normalizedMessage.includes('client_id') &&
      normalizedMessage.includes('sku')
  );
};

const getDuplicateProductSkuMessage = (form = {}, duplicateProduct = null) => {
  const sku = String(form.sku || '').trim() || duplicateProduct?.sku || 'this SKU';
  const productName = duplicateProduct?.productName || duplicateProduct?.product_name || duplicateProduct?.name || '';

  return productName
    ? `SKU "${sku}" already exists for this client on "${productName}". Please edit that product or use a different SKU.`
    : `SKU "${sku}" already exists for this client. Please edit the existing product or use a different SKU.`;
};

const toFormNumberValue = (value) => {
  if (value === null || value === undefined || String(value).trim() === '') return '';
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? String(value) : '';
};

const escapeCsvValue = (value = '') => {
  const normalizedValue = String(value ?? '');
  return /[",\r\n]/.test(normalizedValue)
    ? `"${normalizedValue.replace(/"/g, '""')}"`
    : normalizedValue;
};

const downloadCsvText = (csvText = '', fileName = 'products.csv') => {
  const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  window.URL.revokeObjectURL(url);
};

const getProductRecordIdFromPayload = (payload = {}, fallbackId = '') =>
  String(
    extractProductDetail(payload)?.id ||
      extractProductDetail(payload)?.uuid ||
      payload?.id ||
      payload?.uuid ||
      fallbackId ||
      ''
  ).trim();

const uploadProductDefaultFnskuLabel = async ({ productId, file, buildHeaders, parseResponse }) => {
  if (!productId || !file) return null;

  const formData = new FormData();
  formData.append('file', file);
  formData.append('entityType', 'product');
  formData.append('entityId', productId);
  formData.append('fileType', 'fnsku_label');

  const response = await fetch(`${API_BASE_URL}/api/files`, {
    method: 'POST',
    headers: buildHeaders(),
    body: formData,
    skipApiToast: true,
  });

  return parseResponse(response);
};

const notifyProductCatalogUpdated = () => {
  if (typeof window === 'undefined') return;

  window.dispatchEvent(
    new CustomEvent(API_MUTATION_EVENT_NAME, {
      detail: { method: 'POST', url: '/api/products' },
    })
  );
};

const Products = () => {
  const [products, setProducts] = useState([]);
  const [clients, setClients] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [clientFilter, setClientFilter] = useState('');
  const [clientFilterSearch, setClientFilterSearch] = useState('');
  const [isClientFilterOpen, setIsClientFilterOpen] = useState(false);
  const [formClientSearch, setFormClientSearch] = useState('');
  const [isFormClientOpen, setIsFormClientOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [selectedProductIds, setSelectedProductIds] = useState([]);
  const [showViewModal, setShowViewModal] = useState(false);
  const [showFormModal, setShowFormModal] = useState(false);
  const [deleteProduct, setDeleteProduct] = useState(null);
  const [bulkDeleteProducts, setBulkDeleteProducts] = useState([]);
  const [productForm, setProductForm] = useState(initialProductForm);
  const [editingProductId, setEditingProductId] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [deletingProductId, setDeletingProductId] = useState('');
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importFile, setImportFile] = useState(null);
  const [productFormError, setProductFormError] = useState('');
  const importInputRef = useRef(null);
  const clientFilterRef = useRef(null);
  const formClientRef = useRef(null);

  const setMessage = (nextMessage = '') => {
    const toastMessage = String(nextMessage || '').trim();
    if (toastMessage) showToast('success', toastMessage);
  };

  const setError = (nextError = '') => {
    const toastMessage = String(nextError || '').trim();
    if (toastMessage) showToast('error', toastMessage);
  };

  const loadClients = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/clients`, {
        method: 'GET',
        headers: buildHeaders(),
      });
      const payload = await parseResponse(response);
      setClients(extractClients(payload));
    } catch {
      setClients([]);
    }
  };

  const loadProducts = async () => {
    try {
      setIsLoading(true);
      setError('');
      const query = new URLSearchParams();

      if (clientFilter.trim()) {
        query.set('clientId', clientFilter.trim());
      }

      if (statusFilter === 'active') {
        query.set('active', 'true');
      }

      if (statusFilter === 'inactive') {
        query.set('active', 'false');
      }

      const response = await fetch(
        `${API_BASE_URL}/api/products${query.toString() ? `?${query.toString()}` : ''}`,
        {
          method: 'GET',
          headers: buildHeaders(),
          cache: 'no-store',
          skipApiGetCache: true,
        }
      );
      const payload = await parseResponse(response);
      setProducts(extractProducts(payload).map(normalizeProduct));
    } catch (requestError) {
      setError(requestError.message);
      setProducts([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadProducts();
  }, [clientFilter, statusFilter]);

  useEffect(() => {
    let refreshTimer = null;

    const scheduleProductRefresh = (event) => {
      const url = String(event?.detail?.url || '');
      if (!url.includes('/api/products') && !url.includes('/api/shipments') && !url.includes('/api/files')) return;

      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        loadProducts();
      }, 500);
    };

    window.addEventListener(API_MUTATION_EVENT_NAME, scheduleProductRefresh);

    return () => {
      window.clearTimeout(refreshTimer);
      window.removeEventListener(API_MUTATION_EVENT_NAME, scheduleProductRefresh);
    };
  }, [clientFilter, statusFilter]);

  useEffect(() => {
    loadClients();
  }, []);

  useEffect(() => {
    const handleDocumentMouseDown = (event) => {
      if (!clientFilterRef.current?.contains(event.target)) {
        setIsClientFilterOpen(false);
      }

      if (!formClientRef.current?.contains(event.target)) {
        setIsFormClientOpen(false);
      }
    };

    document.addEventListener('mousedown', handleDocumentMouseDown);
    return () => document.removeEventListener('mousedown', handleDocumentMouseDown);
  }, []);

  const clientLookup = useMemo(() => {
    const lookup = new Map();

    clients.forEach((client) => {
      const clientId = String(getClientId(client) || '').trim();
      if (clientId) lookup.set(clientId, client);
    });

    return lookup;
  }, [clients]);

  const clientOptions = useMemo(
    () =>
      clients
        .map((client) => {
          const id = String(getClientId(client) || '').trim();
          if (!id) return null;

          const name = getClientName(client);
          const email = getClientEmail(client);
          const label = name && email && name !== email ? `${name} (${email})` : name || email || 'Unnamed Client';

          return { id, label, name, email };
        })
        .filter(Boolean)
        .sort((firstClient, secondClient) => firstClient.label.localeCompare(secondClient.label)),
    [clients]
  );
  const selectedClientFilter = useMemo(
    () => clientOptions.find((client) => client.id === clientFilter) || null,
    [clientOptions, clientFilter]
  );
  const selectedFormClient = useMemo(
    () => clientOptions.find((client) => client.id === productForm.clientId) || null,
    [clientOptions, productForm.clientId]
  );
  const selectedFormClientLabel = selectedFormClient?.label || (productForm.clientId ? 'Current client' : '');
  const filteredClientOptions = useMemo(() => {
    const term = clientFilterSearch.trim().toLowerCase();
    if (!term) return clientOptions;

    return clientOptions.filter((client) =>
      [client.label, client.name, client.email, client.id]
        .some((value) => String(value || '').toLowerCase().includes(term))
    );
  }, [clientOptions, clientFilterSearch]);
  const filteredFormClientOptions = useMemo(() => {
    const term = formClientSearch.trim().toLowerCase();
    if (!term || (selectedFormClientLabel && formClientSearch === selectedFormClientLabel)) return clientOptions;

    return clientOptions.filter((client) =>
      [client.label, client.name, client.email, client.id]
        .some((value) => String(value || '').toLowerCase().includes(term))
    );
  }, [clientOptions, formClientSearch, selectedFormClientLabel]);

  useEffect(() => {
    if (!isClientFilterOpen) {
      setClientFilterSearch(selectedClientFilter?.label || '');
    }
  }, [isClientFilterOpen, selectedClientFilter]);

  useEffect(() => {
    if (!isFormClientOpen) {
      setFormClientSearch(selectedFormClientLabel);
    }
  }, [isFormClientOpen, selectedFormClientLabel]);

  const selectClientFilter = (clientId = '') => {
    const nextClient = clientOptions.find((client) => client.id === clientId);
    setClientFilter(clientId);
    setClientFilterSearch(nextClient?.label || '');
    setIsClientFilterOpen(false);
  };

  const clearClientFilter = () => {
    setClientFilter('');
    setClientFilterSearch('');
    setIsClientFilterOpen(false);
  };

  const selectFormClient = (clientId = '') => {
    const nextClient = clientOptions.find((client) => client.id === clientId);
    setProductFormError('');
    setProductForm((prev) => ({ ...prev, clientId }));
    setFormClientSearch(nextClient?.label || '');
    setIsFormClientOpen(false);
  };

  const getProductClientDisplay = useMemo(() => (product = {}) => {
    const matchedClient = clientLookup.get(String(product.clientId || '').trim());
    const name = product.clientName || getClientName(matchedClient);
    const email = product.clientEmail || getClientEmail(matchedClient);

    return {
      primary: name || email || 'Unknown client',
      secondary: name && email && name !== email ? email : '',
    };
  }, [clientLookup]);

  const filteredProducts = useMemo(
    () =>
      products.filter((product) => {
        const term = searchTerm.toLowerCase();
        const clientDisplay = getProductClientDisplay(product);

        return (
          product.productName.toLowerCase().includes(term) ||
          product.sku.toLowerCase().includes(term) ||
          clientDisplay.primary.toLowerCase().includes(term) ||
          clientDisplay.secondary.toLowerCase().includes(term) ||
          product.clientId.toLowerCase().includes(term)
        );
      }),
    [products, searchTerm, getProductClientDisplay]
  );

  const totalProductPages = Math.max(1, Math.ceil(filteredProducts.length / PRODUCTS_PER_PAGE));

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, clientFilter, statusFilter]);

  useEffect(() => {
    setCurrentPage((page) => Math.min(Math.max(page, 1), totalProductPages));
  }, [totalProductPages]);

  const paginatedProducts = useMemo(() => {
    const startIndex = (currentPage - 1) * PRODUCTS_PER_PAGE;
    return filteredProducts.slice(startIndex, startIndex + PRODUCTS_PER_PAGE);
  }, [filteredProducts, currentPage]);

  const visibleProductIds = useMemo(
    () => paginatedProducts.map((product) => String(product.id || '').trim()).filter(Boolean),
    [paginatedProducts]
  );
  const selectedProductsForBulkDelete = useMemo(() => {
    const selectedIds = new Set(selectedProductIds);
    return products.filter((product) => selectedIds.has(String(product.id || '').trim()));
  }, [products, selectedProductIds]);
  const selectedVisibleProductCount = visibleProductIds.filter((productId) =>
    selectedProductIds.includes(productId)
  ).length;
  const allVisibleProductsSelected =
    visibleProductIds.length > 0 && selectedVisibleProductCount === visibleProductIds.length;
  const paginationStart = filteredProducts.length ? (currentPage - 1) * PRODUCTS_PER_PAGE + 1 : 0;
  const paginationEnd = Math.min(currentPage * PRODUCTS_PER_PAGE, filteredProducts.length);
  const paginationPages = useMemo(() => {
    const maxVisiblePages = 5;
    const firstPage = Math.max(1, currentPage - 2);
    const lastPage = Math.min(totalProductPages, firstPage + maxVisiblePages - 1);
    const adjustedFirstPage = Math.max(1, lastPage - maxVisiblePages + 1);

    return Array.from({ length: lastPage - adjustedFirstPage + 1 }, (_, index) => adjustedFirstPage + index);
  }, [currentPage, totalProductPages]);

  useEffect(() => {
    setSelectedProductIds((currentIds) => {
      const availableIds = new Set(products.map((product) => String(product.id || '').trim()).filter(Boolean));
      return currentIds.filter((productId) => availableIds.has(productId));
    });
  }, [products]);

  const toggleProductSelection = (productId) => {
    const normalizedProductId = String(productId || '').trim();
    if (!normalizedProductId) return;

    setSelectedProductIds((currentIds) =>
      currentIds.includes(normalizedProductId)
        ? currentIds.filter((currentId) => currentId !== normalizedProductId)
        : [...currentIds, normalizedProductId]
    );
  };

  const toggleAllVisibleProducts = () => {
    if (!visibleProductIds.length) return;

    setSelectedProductIds((currentIds) => {
      if (allVisibleProductsSelected) {
        return currentIds.filter((productId) => !visibleProductIds.includes(productId));
      }

      return [...new Set([...currentIds, ...visibleProductIds])];
    });
  };

  const resolvedExportClientId = useMemo(() => {
    if (clientFilter.trim()) {
      return clientFilter.trim();
    }

    const uniqueClientIds = [
      ...new Set(filteredProducts.map((product) => product.clientId).filter(Boolean)),
    ];

    return uniqueClientIds.length === 1 ? uniqueClientIds[0] : '';
  }, [clientFilter, filteredProducts]);

  const openCreateModal = () => {
    setEditingProductId('');
    setProductForm(initialProductForm);
    setProductFormError('');
    setFormClientSearch('');
    setIsFormClientOpen(false);
    setShowFormModal(true);
  };

  const closeProductFormModal = () => {
    setShowFormModal(false);
    setProductFormError('');
    setFormClientSearch('');
    setIsFormClientOpen(false);
  };

  const openEditModal = async (product) => {
    const productId = String(product?.id || '').trim();
    let productForEdit = product;

    if (productId) {
      try {
        setError('');
        const response = await fetch(`${API_BASE_URL}/api/products/${encodeURIComponent(productId)}`, {
          method: 'GET',
          headers: buildHeaders(),
          cache: 'no-store',
          skipApiGetCache: true,
        });
        const payload = await parseResponse(response);
        productForEdit = normalizeProduct({
          ...product,
          ...extractProductDetail(payload),
        });
      } catch {
        productForEdit = product;
      }
    }

    setEditingProductId(productId);
    setProductFormError('');
    setProductForm({
      clientId: productForEdit.clientId,
      productName: productForEdit.productName,
      sku: productForEdit.sku,
      defaultFnsku: productForEdit.defaultFnsku,
      defaultFnskuLabelFile: productForEdit.defaultFnskuLabelFile || null,
      defaultFnskuLabelFileName: productForEdit.defaultFnskuLabelFileName || '',
      defaultFnskuLabelUploadFile: null,
      lengthCm: toFormNumberValue(productForEdit.lengthCm),
      widthCm: toFormNumberValue(productForEdit.widthCm),
      heightCm: toFormNumberValue(productForEdit.heightCm),
      weightKg: toFormNumberValue(productForEdit.weightKg),
      hazmatFlag: productForEdit.hazmatFlag,
      expiryTracked: productForEdit.expiryTracked,
      lotTracked: productForEdit.lotTracked,
      needsBundling: productForEdit.needsBundling,
      bundleSize: productForEdit.needsBundling ? String(productForEdit.bundleSize || '1') : '',
      active: productForEdit.active,
    });
    setFormClientSearch('');
    setIsFormClientOpen(false);
    setShowFormModal(true);
  };

  const handleViewProduct = async (productId) => {
    try {
      setError('');
      const response = await fetch(`${API_BASE_URL}/api/products/${productId}`, {
        method: 'GET',
        headers: buildHeaders(),
        cache: 'no-store',
        skipApiGetCache: true,
      });
      const payload = await parseResponse(response);
      setSelectedProduct(normalizeProduct(extractProductDetail(payload)));
      setShowViewModal(true);
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  const handleDefaultFnskuLabelFileChange = (file) => {
    if (!file) return;

    setProductFormError('');
    setProductForm((currentForm) => ({
      ...currentForm,
      defaultFnskuLabelUploadFile: file,
      defaultFnskuLabelFileName: file.name,
    }));
  };

  const handleSaveProduct = async () => {
    if (!productForm.clientId.trim() || !productForm.productName.trim() || !productForm.sku.trim()) {
      const message = 'Client, product name, and SKU are required.';
      setProductFormError(message);
      setError(message);
      return;
    }

    if (productForm.needsBundling && !String(productForm.bundleSize || '').trim()) {
      const message = 'Bundle size is required when bundling is enabled.';
      setProductFormError(message);
      setError(message);
      return;
    }

    const duplicateProduct = editingProductId ? null : findProductWithSameClientSku(products, productForm, editingProductId);
    if (duplicateProduct) {
      const message = getDuplicateProductSkuMessage(productForm, duplicateProduct);
      setProductFormError(message);
      setError(message);
      return;
    }

    try {
      setIsSaving(true);
      setError('');
      setProductFormError('');
      setMessage('');
      const response = await fetch(
        `${API_BASE_URL}${editingProductId ? `/api/products/${editingProductId}` : '/api/products'}`,
        {
          method: editingProductId ? 'PATCH' : 'POST',
          headers: buildHeaders(true),
          body: JSON.stringify(toPayload(productForm, {
            includeClientId: !editingProductId,
            includeSku: !editingProductId,
          })),
          skipApiToast: true,
        }
      );

      const savedProductPayload = await parseResponse(response);
      const savedProductId = getProductRecordIdFromPayload(savedProductPayload, editingProductId);

      if (productForm.defaultFnskuLabelUploadFile) {
        if (!savedProductId) {
          throw new Error('Product saved, but default FNSKU label could not be uploaded because product id was not returned.');
        }

        await uploadProductDefaultFnskuLabel({
          productId: savedProductId,
          file: productForm.defaultFnskuLabelUploadFile,
          buildHeaders,
          parseResponse,
        });
      }

      setMessage(
        productForm.defaultFnskuLabelUploadFile
          ? `${editingProductId ? 'Product updated' : 'Product created'} and default FNSKU label uploaded successfully.`
          : editingProductId ? 'Product updated successfully.' : 'Product created successfully.'
      );
      notifyProductCatalogUpdated();
      setShowFormModal(false);
      setProductForm(initialProductForm);
      await loadProducts();
    } catch (requestError) {
      const message = isDuplicateProductSkuError(requestError.message)
        ? getDuplicateProductSkuMessage(productForm)
        : requestError.message;
      setProductFormError(message);
      setError(message);
    } finally {
      setIsSaving(false);
    }
  };

  const openDeleteProductConfirm = (product) => {
    const productId = String(product?.id || '').trim();

    if (!productId) {
      setMessage('');
      setError('Product id is missing, delete cannot continue.');
      return;
    }

    setError('');
    setMessage('');
    setDeleteProduct(product);
  };

  const openBulkDeleteConfirm = () => {
    if (!selectedProductIds.length) return;

    const productsToDelete = selectedProductsForBulkDelete;

    if (!productsToDelete.length) {
      setSelectedProductIds([]);
      return;
    }

    setError('');
    setMessage('');
    setBulkDeleteProducts(productsToDelete);
  };

  const closeDeleteProductConfirm = () => {
    if (deletingProductId) return;
    setDeleteProduct(null);
  };

  const closeBulkDeleteConfirm = () => {
    if (isBulkDeleting) return;
    setBulkDeleteProducts([]);
  };

  const handleDeleteProduct = async () => {
    const productId = String(deleteProduct?.id || '').trim();

    if (!productId) {
      setMessage('');
      setError('Product id is missing, delete cannot continue.');
      setDeleteProduct(null);
      return;
    }

    try {
      setError('');
      setMessage('');
      setDeletingProductId(productId);
      const response = await fetch(`${API_BASE_URL}/api/products/${encodeURIComponent(productId)}`, {
        method: 'DELETE',
        headers: buildHeaders(),
        skipApiToast: true,
      });
      await parseResponse(response);
      setMessage('Product soft-deleted successfully.');
      setDeleteProduct(null);
      if (selectedProduct && String(selectedProduct.id || '') === productId) {
        setSelectedProduct(null);
        setShowViewModal(false);
      }
      await loadProducts();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setDeletingProductId('');
    }
  };

  const handleBulkDeleteProducts = async () => {
    const productsToDelete = bulkDeleteProducts.length ? bulkDeleteProducts : selectedProductsForBulkDelete;
    const productIds = productsToDelete
      .map((product) => String(product?.id || '').trim())
      .filter(Boolean);

    if (!productIds.length) {
      setBulkDeleteProducts([]);
      setSelectedProductIds([]);
      return;
    }

    try {
      setError('');
      setMessage('');
      setIsBulkDeleting(true);

      const deleteResults = await Promise.allSettled(
        productIds.map(async (productId) => {
          const response = await fetch(`${API_BASE_URL}/api/products/${encodeURIComponent(productId)}`, {
            method: 'DELETE',
            headers: buildHeaders(),
            skipApiToast: true,
          });
          await parseResponse(response);
          return productId;
        })
      );
      const deletedIds = deleteResults
        .filter((result) => result.status === 'fulfilled')
        .map((result) => result.value);
      const failedResults = deleteResults.filter((result) => result.status === 'rejected');

      if (deletedIds.length) {
        setSelectedProductIds((currentIds) => currentIds.filter((productId) => !deletedIds.includes(productId)));
        if (selectedProduct && deletedIds.includes(String(selectedProduct.id || '').trim())) {
          setSelectedProduct(null);
          setShowViewModal(false);
        }
        await loadProducts();
      }

      setBulkDeleteProducts([]);

      if (failedResults.length) {
        const firstError = failedResults[0]?.reason?.message;
        setError(
          `${failedResults.length} product${failedResults.length === 1 ? '' : 's'} could not be deleted.${
            firstError ? ` ${firstError}` : ''
          }`
        );
        if (deletedIds.length) {
          setMessage(`${deletedIds.length} product${deletedIds.length === 1 ? '' : 's'} soft-deleted successfully.`);
        }
        return;
      }

      setMessage(`${deletedIds.length} product${deletedIds.length === 1 ? '' : 's'} soft-deleted successfully.`);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setIsBulkDeleting(false);
    }
  };

  const exportSelectedProductsCsv = () => {
    const headers = [
      'Product ID',
      'Product Name',
      'SKU',
      'Default FNSKU',
      'Client',
      'Client Email',
      'Length CM',
      'Width CM',
      'Height CM',
      'Weight KG',
      'Hazmat',
      'Expiry Tracked',
      'Lot Tracked',
      'Needs Bundling',
      'Bundle Size',
      'Status',
    ];
    const rows = selectedProductsForBulkDelete.map((product) => {
      const clientDisplay = getProductClientDisplay(product);

      return [
        product.id,
        product.productName,
        product.sku,
        product.defaultFnsku,
        clientDisplay.primary,
        clientDisplay.secondary,
        product.lengthCm,
        product.widthCm,
        product.heightCm,
        product.weightKg,
        product.hazmatFlag ? 'Yes' : 'No',
        product.expiryTracked ? 'Yes' : 'No',
        product.lotTracked ? 'Yes' : 'No',
        product.needsBundling ? 'Yes' : 'No',
        product.bundleSize,
        product.status,
      ];
    });
    const csvText = [headers, ...rows]
      .map((row) => row.map(escapeCsvValue).join(','))
      .join('\r\n');
    const suffix = selectedProductsForBulkDelete.length === 1 ? selectedProductsForBulkDelete[0]?.sku || 'selected' : 'selected';

    downloadCsvText(csvText, `products-${suffix}.csv`);
    setMessage(`${selectedProductsForBulkDelete.length} selected product${selectedProductsForBulkDelete.length === 1 ? '' : 's'} exported.`);
  };

  const handleExport = async () => {
    if (selectedProductsForBulkDelete.length) {
      exportSelectedProductsCsv();
      return;
    }

    if (!resolvedExportClientId) {
      const availableClientIds = [
        ...new Set(filteredProducts.map((product) => product.clientId).filter(Boolean)),
      ];

      setError(
        availableClientIds.length > 1
          ? 'Please select product rows or choose one client before exporting.'
          : 'Please select product rows, choose a client, or load products for one specific client before exporting.'
      );
      return;
    }

    try {
      setIsExporting(true);
      setError('');
      const response = await fetch(
        `${API_BASE_URL}/api/products/export?clientId=${encodeURIComponent(resolvedExportClientId)}`,
        {
          method: 'GET',
          headers: buildHeaders(),
        }
      );

      if (!response.ok) {
        await parseResponse(response);
        return;
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `products-${resolvedExportClientId}.csv`;
      link.click();
      window.URL.revokeObjectURL(url);
      setMessage('Products CSV export download started.');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setIsExporting(false);
    }
  };

  const getClientRequiredMessage = (action = 'continue') => {
    const availableClientIds = [
      ...new Set(filteredProducts.map((product) => product.clientId).filter(Boolean)),
    ];

    return availableClientIds.length > 1
      ? `Please select a client before ${action}, because the current list contains multiple clients.`
      : `Please select a client first or load products for one specific client before ${action}.`;
  };

  const handleImportClick = () => {
    if (isImporting) return;

    if (!resolvedExportClientId) {
      setError(getClientRequiredMessage('importing'));
      return;
    }

    importInputRef.current?.click();
  };

  const handleImport = async (fileOverride = null) => {
    const csvFile = fileOverride || importFile;

    if (!csvFile) {
      setError('Please select a CSV file first for import.');
      return;
    }

    if (!resolvedExportClientId) {
      setError(getClientRequiredMessage('importing'));
      return;
    }

    try {
      setIsImporting(true);
      setError('');
      const formData = new FormData();
      formData.append('file', csvFile);
      formData.append('clientId', resolvedExportClientId);

      const response = await fetch(`${API_BASE_URL}/api/products/import`, {
        method: 'POST',
        headers: buildHeaders(),
        body: formData,
        skipApiToast: true,
      });

      await parseResponse(response);
      setMessage('Products CSV imported successfully.');
      setImportFile(null);
      await loadProducts();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <Layout>
      <FullPageLoader show={isLoading} label="Loading products..." />
      <div className="">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Product Catalogue</h1>
          
          </div>
          <button
            onClick={openCreateModal}
            className="flex items-center gap-2 px-4 py-2 bg-[#ff6900] text-white rounded-lg text-sm font-medium hover:bg-[#e55d00] transition-colors"
          >
            <Plus size={16} />
            Add Product
          </button>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-4 mb-6">
          <div className="grid grid-cols-1 xl:grid-cols-[1fr_220px_220px_auto] gap-4">
            <div className="relative">
              <Search
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
              />
              <input
                type="text"
                placeholder="Search products, SKU, client..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9 pr-4 py-2 w-full border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#ff6900] focus:border-transparent"
              />
            </div>
            <div ref={clientFilterRef} className="relative">
              <Search
                size={15}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
              />
              <input
                type="text"
                value={clientFilterSearch}
                onFocus={() => {
                  setClientFilterSearch('');
                  setIsClientFilterOpen(true);
                }}
                onChange={(event) => {
                  setClientFilterSearch(event.target.value);
                  setIsClientFilterOpen(true);
                }}
                placeholder="All clients"
                className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-9 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#ff6900]"
              />
              {clientFilter ? (
                <button
                  type="button"
                  onClick={clearClientFilter}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                  aria-label="Clear client filter"
                >
                  <X size={14} />
                </button>
              ) : null}
              {isClientFilterOpen ? (
                <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                  <button
                    type="button"
                    onClick={() => selectClientFilter('')}
                    className={`block w-full px-3 py-2 text-left text-sm hover:bg-orange-50 ${
                      !clientFilter ? 'font-semibold text-[#ff6900]' : 'text-gray-700'
                    }`}
                  >
                    All clients
                  </button>
                  {filteredClientOptions.length ? (
                    filteredClientOptions.map((client) => (
                      <button
                        key={client.id}
                        type="button"
                        onClick={() => selectClientFilter(client.id)}
                        className={`block w-full px-3 py-2 text-left text-sm hover:bg-orange-50 ${
                          clientFilter === client.id ? 'font-semibold text-[#ff6900]' : 'text-gray-700'
                        }`}
                      >
                        <span className="block truncate">{client.name || client.label}</span>
                        {client.email ? (
                          <span className="block truncate text-xs font-normal text-gray-400">{client.email}</span>
                        ) : null}
                      </button>
                    ))
                  ) : (
                    <p className="px-3 py-3 text-sm text-gray-500">No clients found.</p>
                  )}
                </div>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <Filter size={14} className="text-gray-400" />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-3 py-2 border border-gray-200 rounded-lg text-sm w-full focus:outline-none focus:ring-2 focus:ring-[#ff6900] focus:border-transparent"
              >
                <option value="all">All Status</option>
                <option value="active">Active Only</option>
                <option value="inactive">Inactive Only</option>
              </select>
            </div>
            <button
              onClick={loadProducts}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              <RefreshCw size={15} />
              Refresh
            </button>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleExport}
              disabled={isExporting}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isExporting ? <RefreshCw size={15} className="animate-spin" /> : <Download size={15} />}
              {isExporting ? 'Exporting...' : selectedProductIds.length ? 'Export Selected CSV' : 'Export CSV'}
            </button>
            <button
              type="button"
              onClick={handleImportClick}
              disabled={isImporting}
              className="inline-flex items-center gap-2 rounded-lg bg-[#132347] px-4 py-2 text-sm font-medium text-white hover:bg-[#0f1b38] disabled:cursor-not-allowed disabled:opacity-70"
            >
              {isImporting ? <RefreshCw size={15} className="animate-spin" /> : <Upload size={15} />}
              {isImporting ? 'Importing...' : 'Import CSV'}
            </button>
            <input
              ref={importInputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={async (event) => {
                const input = event.currentTarget;
                const file = input.files?.[0] || null;
                setImportFile(file);
                if (file) await handleImport(file);
                input.value = '';
              }}
              className="hidden"
            />
          </div>
        </div>

        {selectedProductIds.length ? (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-100 bg-red-50 px-4 py-3">
            <p className="text-sm font-medium text-red-700">
              {selectedProductIds.length} product{selectedProductIds.length === 1 ? '' : 's'} selected
              {selectedVisibleProductCount && selectedVisibleProductCount !== selectedProductIds.length
                ? ` (${selectedVisibleProductCount} visible)`
                : ''}
            </p>
            <button
              type="button"
              onClick={openBulkDeleteConfirm}
              disabled={isBulkDeleting}
              className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-70"
            >
              <Trash2 size={14} />
              Delete Selected
            </button>
          </div>
        ) : null}

        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="w-12 py-3 pl-6 pr-2 text-left">
                    <input
                      type="checkbox"
                      checked={allVisibleProductsSelected}
                      disabled={!visibleProductIds.length || isLoading}
                      onChange={toggleAllVisibleProducts}
                      aria-label="Select all visible products"
                      className="h-4 w-4 rounded border-gray-300 text-[#ff6900] focus:ring-[#ff6900]"
                    />
                  </th>
                  <th className="text-left py-3 px-6 text-xs font-semibold text-gray-500 uppercase tracking-wider">Product</th>
                  <th className="text-left py-3 px-6 text-xs font-semibold text-gray-500 uppercase tracking-wider">Client</th>
                  <th className="text-left py-3 px-6 text-xs font-semibold text-gray-500 uppercase tracking-wider">SKU</th>
                  <th className="text-left py-3 px-6 text-xs font-semibold text-gray-500 uppercase tracking-wider">Dimensions</th>
                  <th className="text-left py-3 px-6 text-xs font-semibold text-gray-500 uppercase tracking-wider">Weight</th>
                  <th className="text-left py-3 px-6 text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="text-center py-3 px-6 text-xs font-semibold text-gray-500 uppercase tracking-wider">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {isLoading ? (
                  <tr>
                    <td colSpan="8" className="py-10 px-6 text-center text-sm text-gray-500">
                      <LoadingState label="Loading products..." />
                    </td>
                  </tr>
                ) : paginatedProducts.map((product) => {
                  const clientDisplay = getProductClientDisplay(product);
                  const productId = String(product.id || '').trim();
                  const isSelected = selectedProductIds.includes(productId);

                  return (
                  <tr key={product.id} className={`transition-colors ${isSelected ? 'bg-orange-50/40 hover:bg-orange-50/70' : 'hover:bg-gray-50'}`}>
                    <td className="py-3.5 pl-6 pr-2">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleProductSelection(productId)}
                        aria-label={`Select ${product.productName}`}
                        className="h-4 w-4 rounded border-gray-300 text-[#ff6900] focus:ring-[#ff6900]"
                      />
                    </td>
                    <td className="py-3.5 px-6">
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-lg bg-gray-100">
                          <Box size={14} className="text-gray-500" />
                        </div>
                        <div>
                          <span className="block text-sm font-medium text-gray-900">{product.productName}</span>
                        </div>
                      </div>
                    </td>
                    <td className="py-3.5 px-6">
                      <span className="block text-sm text-gray-700">{clientDisplay.primary}</span>
                      {clientDisplay.secondary ? (
                        <span className="block text-xs text-gray-400">{clientDisplay.secondary}</span>
                      ) : null}
                    </td>
                    <td className="py-3.5 px-6">
                      <span className="text-sm font-mono text-gray-600">{product.sku}</span>
                    </td>
                    <td className="py-3.5 px-6">
                      <span className={`text-sm ${product.dimensionsText ? 'text-gray-500' : 'text-gray-400'}`}>
                        {product.dimensionsText || 'Not added'}
                      </span>
                    </td>
                    <td className="py-3.5 px-6">
                      <span className={`text-sm ${product.weightText ? 'text-gray-700' : 'text-gray-400'}`}>
                        {product.weightText || 'Not added'}
                      </span>
                    </td>
                    <td className="py-3.5 px-6">
                      <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium ${
                        product.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                      }`}>
                        {product.status}
                      </span>
                    </td>
                    <td className="py-3.5 px-6 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => handleViewProduct(product.id)}
                          className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-[#ff6900] transition-colors"
                          title="View Product"
                        >
                          <Eye size={16} />
                        </button>
                        <button
                          onClick={() => openEditModal(product)}
                          className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-[#ff6900] transition-colors"
                          title="Edit Product"
                        >
                          <Edit3 size={14} />
                        </button>
                        <button
                          onClick={() => openDeleteProductConfirm(product)}
                          disabled={deletingProductId === String(product.id || '') || isBulkDeleting}
                          className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600 transition-colors"
                          title="Delete Product"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {!isLoading && filteredProducts.length === 0 ? (
            <div className="text-center py-12">
              <Box size={40} className="mx-auto text-gray-300 mb-3" />
              <p className="text-sm text-gray-500">No products found</p>
            </div>
          ) : null}

          <div className="border-t border-gray-200 px-6 py-3 flex items-center justify-between bg-gray-50">
            <p className="text-sm text-gray-500">
              Showing <span className="font-medium text-gray-900">{paginationStart}-{paginationEnd}</span> of{' '}
              <span className="font-medium text-gray-900">{filteredProducts.length}</span> products
            </p>
            <div className="flex items-center gap-2 text-sm">
              <button
                type="button"
                onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                disabled={currentPage === 1}
                className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 font-medium text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Previous
              </button>
              {paginationPages.map((page) => (
                <button
                  key={page}
                  type="button"
                  onClick={() => setCurrentPage(page)}
                  className={`min-w-8 rounded-lg px-3 py-1.5 font-semibold ${
                    currentPage === page
                      ? 'bg-[#ff6900] text-white'
                      : 'border border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {page}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setCurrentPage((page) => Math.min(totalProductPages, page + 1))}
                disabled={currentPage === totalProductPages}
                className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 font-medium text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        </div>

        {showViewModal && selectedProduct ? (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-lg">
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center">
                    <Box size={18} className="text-[#ff6900]" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-gray-900">{selectedProduct.productName}</h2>
                    <span className="text-sm text-gray-500">{selectedProduct.sku}</span>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setShowViewModal(false);
                    setSelectedProduct(null);
                  }}
                  className="p-1 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="p-6 grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-xs text-gray-500 mb-1">Client</p>
                  <p className="font-medium text-gray-900">{getProductClientDisplay(selectedProduct).primary}</p>
                  {getProductClientDisplay(selectedProduct).secondary ? (
                    <p className="text-xs text-gray-500">{getProductClientDisplay(selectedProduct).secondary}</p>
                  ) : null}
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-1">Default FNSKU</p>
                  <p className="font-medium text-gray-900">{selectedProduct.defaultFnsku || '-'}</p>
                </div>
                <div className="col-span-2">
                  <p className="text-xs text-gray-500 mb-1">Default FNSKU Label File</p>
                  {selectedProduct.defaultFnskuLabelFileName ? (
                    selectedProduct.defaultFnskuLabelFileUrl ? (
                      <a
                        href={selectedProduct.defaultFnskuLabelFileUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium text-[#ff6900] hover:text-[#e55d00]"
                      >
                        {selectedProduct.defaultFnskuLabelFileName}
                      </a>
                    ) : (
                      <p className="font-medium text-gray-900">{selectedProduct.defaultFnskuLabelFileName}</p>
                    )
                  ) : (
                    <p className="font-medium text-gray-900">No default label uploaded</p>
                  )}
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-1">Dimensions</p>
                  <p className="font-medium text-gray-900">{selectedProduct.dimensionsText || 'Not added'}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-1">Weight</p>
                  <p className="font-medium text-gray-900">{selectedProduct.weightText || 'Not added'}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-1">Status</p>
                  <p className="font-medium text-gray-900">{selectedProduct.status}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-1">Lot Tracked</p>
                  <p className="font-medium text-gray-900">{selectedProduct.lotTracked ? 'Yes' : 'No'}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-1">Expiry Tracked</p>
                  <p className="font-medium text-gray-900">{selectedProduct.expiryTracked ? 'Yes' : 'No'}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-1">Flags</p>
                  {selectedProduct.flags.length ? (
                    <div className="flex flex-wrap gap-1">
                      {selectedProduct.flags.map((flag) => (
                        <span
                          key={flag}
                          className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700"
                        >
                          {flag}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="font-medium text-gray-900">None</p>
                  )}
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-1">Bundling</p>
                  <p className="font-medium text-gray-900">
                    {selectedProduct.needsBundling ? `Yes (${selectedProduct.bundleSize})` : 'No'}
                  </p>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {bulkDeleteProducts.length ? (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-md overflow-hidden rounded-xl bg-white shadow-xl">
              <div className="flex items-start gap-4 border-b border-gray-200 px-6 py-5">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-600">
                  <Trash2 size={20} />
                </div>
                <div className="min-w-0">
                  <h3 className="text-lg font-semibold text-gray-900">Delete selected products?</h3>
                  <p className="mt-1 text-sm leading-6 text-gray-500">
                    This will soft-delete {bulkDeleteProducts.length} selected product{bulkDeleteProducts.length === 1 ? '' : 's'} from the catalog.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeBulkDeleteConfirm}
                  disabled={isBulkDeleting}
                  className="ml-auto rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label="Close bulk delete confirmation"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="px-6 py-4">
                <div className="max-h-56 space-y-2 overflow-y-auto rounded-lg border border-gray-100 bg-gray-50 p-3 text-sm">
                  {bulkDeleteProducts.slice(0, 6).map((product) => (
                    <div key={product.id || product.sku} className="rounded-md bg-white px-3 py-2">
                      <p className="font-semibold text-gray-900">{product.productName || 'Unnamed Product'}</p>
                      <p className="mt-0.5 text-xs text-gray-500">
                        SKU: {product.sku || '-'} | Client: {getProductClientDisplay(product).primary}
                      </p>
                    </div>
                  ))}
                  {bulkDeleteProducts.length > 6 ? (
                    <p className="px-2 py-1 text-xs font-medium text-gray-500">
                      + {bulkDeleteProducts.length - 6} more selected products
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 border-t border-gray-200 px-6 py-4">
                <button
                  type="button"
                  onClick={closeBulkDeleteConfirm}
                  disabled={isBulkDeleting}
                  className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleBulkDeleteProducts}
                  disabled={isBulkDeleting}
                  className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {isBulkDeleting ? 'Deleting...' : 'Confirm Delete'}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {deleteProduct ? (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-md overflow-hidden rounded-xl bg-white shadow-xl">
              <div className="flex items-start gap-4 border-b border-gray-200 px-6 py-5">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-600">
                  <Trash2 size={20} />
                </div>
                <div className="min-w-0">
                  <h3 className="text-lg font-semibold text-gray-900">Delete product?</h3>
                  <p className="mt-1 text-sm leading-6 text-gray-500">
                    This will soft-delete the product from the catalog.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeDeleteProductConfirm}
                  disabled={Boolean(deletingProductId)}
                  className="ml-auto rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label="Close delete confirmation"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="px-6 py-4">
                <div className="rounded-lg border border-gray-100 bg-gray-50 px-4 py-3 text-sm">
                  <p className="font-semibold text-gray-900">{deleteProduct.productName || 'Unnamed Product'}</p>
                  <p className="mt-1 text-gray-500">SKU: {deleteProduct.sku || '-'}</p>
                  <p className="mt-1 text-gray-500">Client: {getProductClientDisplay(deleteProduct).primary}</p>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 border-t border-gray-200 px-6 py-4">
                <button
                  type="button"
                  onClick={closeDeleteProductConfirm}
                  disabled={Boolean(deletingProductId)}
                  className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDeleteProduct}
                  disabled={Boolean(deletingProductId)}
                  className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {deletingProductId ? 'Deleting...' : 'Confirm Delete'}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {showFormModal ? (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl">
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900">
                  {editingProductId ? 'Update Product' : 'Create Product'}
                </h3>
                <button
                  onClick={closeProductFormModal}
                  className="p-1 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div ref={formClientRef} className="relative block">
                  <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">Client</span>
                  <Search
                    size={15}
                    className="pointer-events-none absolute left-3 top-[42px] -translate-y-1/2 text-gray-400"
                  />
                  <input
                    type="text"
                    value={formClientSearch}
                    onFocus={() => {
                      if (editingProductId) return;
                      setFormClientSearch('');
                      setIsFormClientOpen(true);
                    }}
                    onChange={(event) => {
                      if (editingProductId) return;
                      setFormClientSearch(event.target.value);
                      setIsFormClientOpen(true);
                    }}
                    disabled={Boolean(editingProductId)}
                    placeholder="Select client"
                    className="w-full rounded-lg border border-gray-200 py-2.5 pl-9 pr-9 text-sm focus:outline-none focus:ring-2 focus:ring-[#ff6900] disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500 disabled:focus:ring-0"
                  />
                  {productForm.clientId && !editingProductId ? (
                    <button
                      type="button"
                      onClick={() => selectFormClient('')}
                      className="absolute right-2 top-[42px] -translate-y-1/2 rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                      aria-label="Clear selected client"
                    >
                      <X size={14} />
                    </button>
                  ) : null}
                  {isFormClientOpen ? (
                    <div className="absolute left-0 right-0 top-full z-[70] mt-1 max-h-72 overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                      {productForm.clientId && !selectedFormClient ? (
                        <button
                          type="button"
                          onClick={() => selectFormClient(productForm.clientId)}
                          className="block w-full px-3 py-2 text-left text-sm font-semibold text-[#ff6900] hover:bg-orange-50"
                        >
                          Current client
                        </button>
                      ) : null}
                      {filteredFormClientOptions.length ? (
                        filteredFormClientOptions.map((client) => (
                          <button
                            key={client.id}
                            type="button"
                            onClick={() => selectFormClient(client.id)}
                            className={`block w-full px-3 py-2 text-left text-sm hover:bg-orange-50 ${
                              productForm.clientId === client.id ? 'font-semibold text-[#ff6900]' : 'text-gray-700'
                            }`}
                          >
                            <span className="block truncate">{client.name || client.label}</span>
                            {client.email ? (
                              <span className="block truncate text-xs font-normal text-gray-400">{client.email}</span>
                            ) : null}
                          </button>
                        ))
                      ) : (
                        <p className="px-3 py-3 text-sm text-gray-500">No clients found.</p>
                      )}
                    </div>
                  ) : null}
                </div>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">Product Name</span>
                  <input
                    type="text"
                    placeholder="Product Name"
                    value={productForm.productName}
                    onChange={(e) => {
                      setProductFormError('');
                      setProductForm((prev) => ({ ...prev, productName: e.target.value }));
                    }}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#ff6900]"
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">SKU</span>
                  <input
                    type="text"
                    placeholder="SKU"
                    value={productForm.sku}
                    disabled={Boolean(editingProductId)}
                    onChange={(e) => {
                      setProductFormError('');
                      setProductForm((prev) => ({ ...prev, sku: e.target.value }));
                    }}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#ff6900] disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500 disabled:focus:ring-0"
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">Default FNSKU</span>
                  <input
                    type="text"
                    placeholder="Default FNSKU"
                    value={productForm.defaultFnsku}
                    onChange={(e) => setProductForm((prev) => ({ ...prev, defaultFnsku: e.target.value }))}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#ff6900]"
                  />
                </label>
                <label className="block md:col-span-2">
                  <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">Default FNSKU Label File</span>
                  <input
                    type="file"
                    accept=".pdf,.csv,application/pdf,text/csv,application/vnd.ms-excel,image/*"
                    onChange={(event) => {
                      handleDefaultFnskuLabelFileChange(event.target.files?.[0] || null);
                      event.target.value = '';
                    }}
                    className="w-full rounded-lg border border-dashed border-gray-300 px-3 py-2.5 text-sm text-gray-600 file:mr-3 file:rounded-md file:border-0 file:bg-[#fff7ed] file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-[#ff6900] hover:border-[#ffb37a]"
                  />
                  <p className="mt-2 text-xs text-gray-500">
                    {productForm.defaultFnskuLabelUploadFile
                      ? `Selected: ${productForm.defaultFnskuLabelUploadFile.name}. It will upload after the product is saved.`
                      : productForm.defaultFnskuLabelFileName
                        ? `Current default label: ${productForm.defaultFnskuLabelFileName}`
                        : 'Upload a PDF, CSV, PNG, JPG, or other FNSKU label file. New products upload this after the product is created.'}
                  </p>
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">Length (cm)</span>
                  <input
                    type="number"
                    placeholder="Length cm"
                    value={productForm.lengthCm}
                    onChange={(e) => setProductForm((prev) => ({ ...prev, lengthCm: e.target.value }))}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#ff6900]"
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">Width (cm)</span>
                  <input
                    type="number"
                    placeholder="Width cm"
                    value={productForm.widthCm}
                    onChange={(e) => setProductForm((prev) => ({ ...prev, widthCm: e.target.value }))}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#ff6900]"
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">Height (cm)</span>
                  <input
                    type="number"
                    placeholder="Height cm"
                    value={productForm.heightCm}
                    onChange={(e) => setProductForm((prev) => ({ ...prev, heightCm: e.target.value }))}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#ff6900]"
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">Weight (kg)</span>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="Weight kg"
                    value={productForm.weightKg}
                    onChange={(e) => setProductForm((prev) => ({ ...prev, weightKg: e.target.value }))}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#ff6900]"
                  />
                </label>
                <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={productForm.hazmatFlag}
                    onChange={(e) => setProductForm((prev) => ({ ...prev, hazmatFlag: e.target.checked }))}
                  />
                  Hazmat
                </label>
                <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={productForm.expiryTracked}
                    onChange={(e) => setProductForm((prev) => ({ ...prev, expiryTracked: e.target.checked }))}
                  />
                  Expiry Tracked
                </label>
                <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={productForm.lotTracked}
                    onChange={(e) => setProductForm((prev) => ({ ...prev, lotTracked: e.target.checked }))}
                  />
                  Lot Tracked
                </label>
                <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={productForm.active}
                    onChange={(e) => setProductForm((prev) => ({ ...prev, active: e.target.checked }))}
                  />
                  Active
                </label>
                <label className="inline-flex items-center gap-2 text-sm text-gray-700 md:col-span-2">
                  <input
                    type="checkbox"
                    checked={productForm.needsBundling}
                    onChange={(e) =>
                      setProductForm((prev) => ({
                        ...prev,
                        needsBundling: e.target.checked,
                        bundleSize: e.target.checked && !prev.bundleSize ? '1' : prev.bundleSize,
                      }))
                    }
                  />
                  Needs Bundling
                </label>
                <label className="block md:col-span-2">
                  <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">Bundle Size</span>
                  <input
                    type="number"
                    placeholder="Bundle Size"
                    value={productForm.bundleSize}
                    onChange={(e) => setProductForm((prev) => ({ ...prev, bundleSize: e.target.value }))}
                    disabled={!productForm.needsBundling}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#ff6900] disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400 disabled:focus:ring-0"
                  />
                </label>
                {productFormError ? (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 md:col-span-2">
                    {productFormError}
                  </div>
                ) : null}
              </div>

              <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-xl">
                <button
                  onClick={closeProductFormModal}
                  className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-100"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveProduct}
                  disabled={isSaving}
                  className="px-4 py-2 bg-[#ff6900] text-white rounded-lg text-sm font-medium hover:bg-[#e55d00] disabled:opacity-60"
                >
                  {isSaving ? 'Saving...' : editingProductId ? 'Update Product' : 'Create Product'}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </Layout>
  );
};

export default Products;
