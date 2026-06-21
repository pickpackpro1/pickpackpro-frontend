import { useEffect, useMemo, useState } from 'react';
import LayoutClient from './clientlayout/LayoutClient';
import LoadingState from '../common/LoadingState';
import FullPageLoader from '../common/FullPageLoader';
import {
  Search,
  Package,
  AlertTriangle,
  Truck,
  Eye,
  Edit3,
  Plus,
  RefreshCw,
  Upload,
  X,
} from 'lucide-react';
import { getSession } from '../../utils/auth';
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
import { API_MUTATION_EVENT_NAME } from '../../utils/toast';

const API_BASE_URL = '';

const initialProductForm = {
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
  const text = await response.text();
  let payload = null;

  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!response.ok) {
    const message =
      payload?.message ||
      payload?.error ||
      payload?.details ||
      (typeof payload === 'string' ? payload : '') ||
      `Request failed with status ${response.status}`;

    throw new Error(message);
  }

  return payload;
};

const extractProducts = (payload) => {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (Array.isArray(payload?.products)) {
    return payload.products;
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

const toOptionalNumber = (value) => {
  const normalizedValue = String(value ?? '').trim();
  return normalizedValue ? Number(normalizedValue) : undefined;
};

const toFormNumberValue = (value) => {
  if (value === null || value === undefined || String(value).trim() === '') return '';
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? String(value) : '';
};

const toPayload = (form, { includeSku = true } = {}) => {
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

  if (includeSku) payload.sku = form.sku.trim();

  return payload;
};

const normalizeProductIdentityValue = (value = '') => String(value || '').trim().toLowerCase();

const isDuplicateProductSkuError = (message = '') => {
  const normalizedMessage = String(message || '').toLowerCase();
  return normalizedMessage.includes('unique') && normalizedMessage.includes('sku');
};

const getDuplicateProductSkuMessage = (sku = '') =>
  `SKU "${String(sku || '').trim() || 'this SKU'}" already exists in your product catalog. Please edit that product or use a different SKU.`;

const normalizeProduct = (product) => {
  const dimensions = getProductDimensionParts(product);
  const flags = getProductFlags(product);

  return {
    id: product?.id || product?.uuid || '',
    sku: product?.sku || '',
    productName: product?.productName || product?.product_name || product?.name || 'Unnamed Product',
    weightKg: getProductWeightValue(product),
    weightText: getProductWeightText(product),
    flags,
    hazmatFlag: flags.some((flag) => flag.toLowerCase() === 'hazmat'),
    expiryTracked: Boolean(product?.expiryTracked ?? product?.expiry_tracked),
    lotTracked: Boolean(product?.lotTracked ?? product?.lot_tracked),
    needsBundling: Boolean(product?.needsBundling ?? product?.needs_bundling),
    bundleSize: product?.bundleSize ?? product?.bundle_size ?? '',
    defaultFnsku: product?.defaultFnsku || product?.defaultFNSKU || product?.default_fnsku || '',
    defaultFnskuLabelFileId: getProductDefaultFnskuLabelFileId(product),
    defaultFnskuLabelFile: getProductDefaultFnskuLabelFile(product),
    defaultFnskuLabelFileName: getProductDefaultFnskuLabelFileName(product),
    defaultFnskuLabelFileUrl: getProductDefaultFnskuLabelFileUrl(product),
    lengthCm: dimensions.length,
    widthCm: dimensions.width,
    heightCm: dimensions.height,
    dimensionsText: getProductDimensionsText(product),
    active: getProductActiveStatus(product),
  };
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
  });

  return parseResponse(response);
};

const ProductsClient = () => {
  const [products, setProducts] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [showViewModal, setShowViewModal] = useState(false);
  const [showFormModal, setShowFormModal] = useState(false);
  const [productForm, setProductForm] = useState(initialProductForm);
  const [editingProductId, setEditingProductId] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [productFormError, setProductFormError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const loadProducts = async () => {
    try {
      setIsLoading(true);
      setError('');
      const response = await fetch(`${API_BASE_URL}/api/products`, {
        method: 'GET',
        headers: buildHeaders(),
        cache: 'no-store',
        skipApiGetCache: true,
      });
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
  }, []);

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
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 250);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const filteredProducts = useMemo(
    () =>
      products.filter((product) => {
        const term = debouncedSearchQuery.toLowerCase();
        return (
          product.sku.toLowerCase().includes(term) ||
          product.productName.toLowerCase().includes(term)
        );
      }),
    [products, debouncedSearchQuery]
  );

  const handleViewProduct = (product) => {
    setError('');
    setSelectedProduct(normalizeProduct(product));
    setShowViewModal(true);
  };

  const openCreateModal = () => {
    setEditingProductId('');
    setProductForm(initialProductForm);
    setProductFormError('');
    setShowFormModal(true);
  };

  const closeProductFormModal = () => {
    if (isSaving) return;
    setShowFormModal(false);
    setProductForm(initialProductForm);
    setProductFormError('');
    setEditingProductId('');
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
    setShowFormModal(true);
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
    if (!productForm.productName.trim() || !productForm.sku.trim()) {
      const message = 'Product name and SKU are required.';
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

    if (!editingProductId) {
      const targetSku = normalizeProductIdentityValue(productForm.sku);
      const duplicateProduct = products.find((product) => normalizeProductIdentityValue(product.sku) === targetSku);
      if (duplicateProduct) {
        const message = getDuplicateProductSkuMessage(productForm.sku);
        setProductFormError(message);
        setError(message);
        return;
      }
    }

    try {
      setIsSaving(true);
      setError('');
      setProductFormError('');
      const response = await fetch(
        `${API_BASE_URL}${editingProductId ? `/api/products/${encodeURIComponent(editingProductId)}` : '/api/products'}`,
        {
          method: editingProductId ? 'PATCH' : 'POST',
          headers: buildHeaders(true),
          body: JSON.stringify(toPayload(productForm, { includeSku: !editingProductId })),
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

      setShowFormModal(false);
      setProductForm(initialProductForm);
      setEditingProductId('');
      await loadProducts();
    } catch (requestError) {
      const message = isDuplicateProductSkuError(requestError.message)
        ? getDuplicateProductSkuMessage(productForm.sku)
        : requestError.message || 'Product could not be saved.';
      setProductFormError(message);
      setError(message);
    } finally {
      setIsSaving(false);
    }
  };

  const totalProducts = products.length;
  const flaggedProducts = products.filter((product) => product.flags.length).length;
  const activeProducts = products.filter((product) => product.active).length;

  return (
    <LayoutClient>
      <FullPageLoader show={isLoading} label="Loading products..." />
      <div className="min-h-screen ">
        <div className="">
          <div className="mb-6 flex items-start justify-between gap-4">
            <div>
              <h1 className="text-[34px] font-semibold leading-none text-[#132347]">MyProducts</h1>
              <p className="mt-2 text-sm text-[#64748b]">View your inventory catalog and product specifications.</p>
            </div>
            <button
              type="button"
              onClick={openCreateModal}
              className="inline-flex items-center gap-2 rounded-lg bg-[#ff6900] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#e55d00]"
            >
              <Plus size={16} />
              Add Product
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <div className="bg-white rounded-2xl border border-[#dde6f2] p-6 relative overflow-hidden">
              <div className="flex items-start justify-between mb-4">
                <span className="text-sm font-semibold uppercase tracking-wider text-gray-400">
                  TOTAL PRODUCTS
                </span>
                <div className="w-10 h-10 rounded-full bg-blue-50 flex items-center justify-center">
                  <Package size={20} className="text-blue-500" />
                </div>
              </div>
              <div className="text-4xl font-bold text-[#132347] mb-1">{totalProducts}</div>
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#f97316]">
                +12% vs last month
              </span>
            </div>

            <div className="bg-white rounded-2xl border border-[#dde6f2] p-6 relative overflow-hidden">
              <div className="flex items-start justify-between mb-4">
                <span className="text-sm font-semibold uppercase tracking-wider text-gray-400">
                  HAZMAT / FLAGS
                </span>
                <div className="w-10 h-10 rounded-full bg-amber-50 flex items-center justify-center">
                  <AlertTriangle size={20} className="text-amber-500" />
                </div>
              </div>
              <div className="text-4xl font-bold text-[#b7791f] mb-1">{flaggedProducts.toString().padStart(2, '0')}</div>
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#b45309]">
                Requires attention
              </span>
            </div>

            <div className="bg-white rounded-2xl border border-[#dde6f2] p-6 relative overflow-hidden">
              <div className="flex items-start justify-between mb-4">
                <span className="text-sm font-semibold uppercase tracking-wider text-gray-400">
                  ACTIVE PRODUCTS
                </span>
                <div className="w-10 h-10 rounded-full bg-green-50 flex items-center justify-center">
                  <Truck size={20} className="text-green-500" />
                </div>
              </div>
              <div className="text-4xl font-bold text-[#132347] mb-1">{activeProducts}</div>
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#f97316]">
                All on track
              </span>
            </div>
          </div>

          <div className="bg-[#eaf6fb] border border-[#c9e4ef] rounded-xl p-4 mb-8 flex items-center justify-between gap-3">
            <p className="text-sm text-[#385a74]">
              Keep your product FNSKUs up to date. When submitting a shipment, the correct FNSKU is pre-filled automatically.
            </p>
            <button
              type="button"
              onClick={loadProducts}
              className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-white px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50"
            >
              <RefreshCw size={15} />
              Refresh
            </button>
          </div>

          <div className="flex items-center justify-between mb-6">
            <div className="relative w-full max-w-sm">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search products..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-lg border border-gray-200 pl-9 pr-4 py-2.5 text-sm text-[#132347] focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#ff6900]"
              />
            </div>
          </div>

          {error ? (
            <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </p>
          ) : null}

          <div className="bg-white rounded-2xl border border-[#dce5f1] overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] table-fixed">
                <colgroup>
                  <col className="w-[10%]" />
                  <col className="w-[15%]" />
                  <col className="w-[13%]" />
                  <col className="w-[11%]" />
                  <col className="w-[10%]" />
                  <col className="w-[29%]" />
                  <col className="w-[12%]" />
                </colgroup>
                <thead>
                  <tr className="border-b border-[#e8eef7] bg-[#f8fbff]">
                    <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                      SKU
                    </th>
                    <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                      PRODUCT NAME
                    </th>
                    <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                      DEFAULT FNSKU
                    </th>
                    <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                      DIMS (CM)
                    </th>
                    <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                      WEIGHT
                    </th>
                    <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                      FLAGS
                    </th>
                    <th className="px-5 py-3 text-center text-xs font-semibold uppercase tracking-wider text-gray-500">
                      ACTIONS
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr>
                      <td colSpan="7" className="py-10 px-6 text-center text-sm text-gray-500">
                        <LoadingState label="Loading products..." />
                      </td>
                    </tr>
                  ) : filteredProducts.map((product) => (
                    <tr
                      key={product.id}
                      className="border-b border-gray-100 transition-colors last:border-b-0 hover:bg-gray-50/30"
                    >
                      <td className="px-5 py-3 align-middle">
                        <span className="block truncate text-sm font-semibold text-blue-600">{product.sku}</span>
                      </td>
                      <td className="px-5 py-3 align-middle">
                        <span className="block truncate text-sm font-medium text-gray-900">{product.productName}</span>
                      </td>
                      <td className="px-5 py-3 align-middle text-sm text-gray-600">{product.defaultFnsku || '-'}</td>
                      <td className="px-5 py-3 align-middle text-sm text-gray-600">
                        <span className={`block truncate ${product.dimensionsText ? 'text-gray-600' : 'text-gray-400'}`}>
                          {product.dimensionsText || 'Not added'}
                        </span>
                      </td>
                      <td className="px-5 py-3 align-middle">
                        <span className={`block truncate text-sm ${product.weightText ? 'text-gray-700' : 'text-gray-400'}`}>
                          {product.weightText || 'Not added'}
                        </span>
                      </td>
                      <td className="px-5 py-3 align-middle">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {product.flags.length ? (
                            product.flags.map((flag) => (
                              <span
                                key={flag}
                                className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700"
                              >
                                {flag}
                              </span>
                            ))
                          ) : (
                            <span className="text-sm text-gray-400">-</span>
                          )}
                        </div>
                      </td>
                      <td className="px-5 py-3 align-middle">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleViewProduct(product)}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[#dbe2ee] bg-white text-[#64748b] transition-colors hover:bg-[#f8fafc]"
                            title="View product"
                            aria-label={`View ${product.productName}`}
                          >
                            <Eye size={15} />
                          </button>
                          <button
                            type="button"
                            onClick={() => openEditModal(product)}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[#dbe2ee] bg-white text-[#64748b] transition-colors hover:bg-[#f8fafc]"
                            title="Edit product"
                            aria-label={`Edit ${product.productName}`}
                          >
                            <Edit3 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 bg-gray-50/30">
              <p className="text-sm text-gray-500">
                Showing <span className="font-medium text-gray-700">{filteredProducts.length}</span> of{' '}
                <span className="font-medium text-gray-700">{products.length}</span> products
              </p>
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <button type="button" className="rounded-md border border-[#d8e0ee] px-2 py-1">{'<'}</button>
                <button type="button" className="rounded-md bg-[#ff8c2f] px-2 py-1 text-white">1</button>
                <button type="button" className="rounded-md border border-[#d8e0ee] px-2 py-1">2</button>
                <button type="button" className="rounded-md border border-[#d8e0ee] px-2 py-1">3</button>
                <button type="button" className="rounded-md border border-[#d8e0ee] px-2 py-1">{'>'}</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {showViewModal && selectedProduct ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-3xl bg-white shadow-[0_24px_80px_rgba(15,23,42,0.22)]">
            <div className="flex items-center justify-between border-b border-gray-100 px-8 py-6">
              <div>
                <h2 className="text-xl font-semibold text-[#132347]">{selectedProduct.productName}</h2>
                <p className="text-sm text-gray-500 mt-1">{selectedProduct.sku}</p>
              </div>
              <button
                type="button"
                onClick={() => setShowViewModal(false)}
                className="rounded-full p-2 text-gray-500 transition-colors hover:bg-gray-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-8 grid grid-cols-2 gap-4 text-sm">
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
                <p className="text-xs text-gray-500 mb-1">Weight</p>
                <p className="font-medium text-gray-900">{selectedProduct.weightText || 'Not added'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Dimensions</p>
                <p className="font-medium text-gray-900">{selectedProduct.dimensionsText || 'Not added'}</p>
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
                <p className="text-xs text-gray-500 mb-1">Lot Tracked</p>
                <p className="font-medium text-gray-900">{selectedProduct.lotTracked ? 'Yes' : 'No'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Expiry Tracked</p>
                <p className="font-medium text-gray-900">{selectedProduct.expiryTracked ? 'Yes' : 'No'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Status</p>
                <p className="font-medium text-gray-900">{selectedProduct.active ? 'Active' : 'Inactive'}</p>
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

      {showFormModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-hidden rounded-2xl bg-white shadow-[0_24px_80px_rgba(15,23,42,0.22)]">
            <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
              <h3 className="text-lg font-semibold text-[#132347]">
                {editingProductId ? 'Edit Product' : 'Add Product'}
              </h3>
              <button
                type="button"
                onClick={closeProductFormModal}
                disabled={isSaving}
                className="rounded-lg p-1 text-gray-500 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <X size={20} />
              </button>
            </div>

            <div className="max-h-[calc(90vh-132px)] overflow-y-auto p-6">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">Product Name</span>
                  <input
                    type="text"
                    value={productForm.productName}
                    onChange={(event) => {
                      setProductFormError('');
                      setProductForm((currentForm) => ({ ...currentForm, productName: event.target.value }));
                    }}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#ff6900]"
                    placeholder="Product name"
                  />
                </label>

                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">SKU</span>
                  <input
                    type="text"
                    value={productForm.sku}
                    disabled={Boolean(editingProductId)}
                    onChange={(event) => {
                      setProductFormError('');
                      setProductForm((currentForm) => ({ ...currentForm, sku: event.target.value }));
                    }}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#ff6900] disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500 disabled:focus:ring-0"
                    placeholder="SKU"
                  />
                </label>

                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">Default FNSKU</span>
                  <input
                    type="text"
                    value={productForm.defaultFnsku}
                    onChange={(event) => setProductForm((currentForm) => ({ ...currentForm, defaultFnsku: event.target.value }))}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#ff6900]"
                    placeholder="Default FNSKU"
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
                  <p className="mt-2 flex items-center gap-1.5 text-xs text-gray-500">
                    <Upload size={13} />
                    <span>
                      {productForm.defaultFnskuLabelUploadFile
                        ? `Selected: ${productForm.defaultFnskuLabelUploadFile.name}. It will upload after the product is saved.`
                        : productForm.defaultFnskuLabelFileName
                          ? `Current default label: ${productForm.defaultFnskuLabelFileName}`
                          : 'Upload a PDF, CSV, PNG, JPG, or other FNSKU label file. New products upload this after the product is created.'}
                    </span>
                  </p>
                </label>

                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">Weight (kg)</span>
                  <input
                    type="number"
                    step="0.01"
                    value={productForm.weightKg}
                    onChange={(event) => setProductForm((currentForm) => ({ ...currentForm, weightKg: event.target.value }))}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#ff6900]"
                    placeholder="Weight kg"
                  />
                </label>

                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">Length (cm)</span>
                  <input
                    type="number"
                    step="0.01"
                    value={productForm.lengthCm}
                    onChange={(event) => setProductForm((currentForm) => ({ ...currentForm, lengthCm: event.target.value }))}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#ff6900]"
                    placeholder="Length"
                  />
                </label>

                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">Width (cm)</span>
                  <input
                    type="number"
                    step="0.01"
                    value={productForm.widthCm}
                    onChange={(event) => setProductForm((currentForm) => ({ ...currentForm, widthCm: event.target.value }))}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#ff6900]"
                    placeholder="Width"
                  />
                </label>

                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">Height (cm)</span>
                  <input
                    type="number"
                    step="0.01"
                    value={productForm.heightCm}
                    onChange={(event) => setProductForm((currentForm) => ({ ...currentForm, heightCm: event.target.value }))}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#ff6900]"
                    placeholder="Height"
                  />
                </label>

                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">Bundle Size</span>
                  <input
                    type="number"
                    value={productForm.bundleSize}
                    disabled={!productForm.needsBundling}
                    onChange={(event) => setProductForm((currentForm) => ({ ...currentForm, bundleSize: event.target.value }))}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#ff6900] disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400 disabled:focus:ring-0"
                    placeholder="Bundle size"
                  />
                </label>

                <div className="grid grid-cols-1 gap-3 md:col-span-2 sm:grid-cols-2">
                  {[
                    ['hazmatFlag', 'Hazmat'],
                    ['expiryTracked', 'Expiry Tracked'],
                    ['lotTracked', 'Lot Tracked'],
                    ['needsBundling', 'Needs Bundling'],
                    ['active', 'Active'],
                  ].map(([field, label]) => (
                    <label key={field} className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                      <input
                        type="checkbox"
                        checked={Boolean(productForm[field])}
                        onChange={(event) =>
                          setProductForm((currentForm) => ({
                            ...currentForm,
                            [field]: event.target.checked,
                            ...(field === 'needsBundling'
                              ? { bundleSize: event.target.checked && !currentForm.bundleSize ? '1' : currentForm.bundleSize }
                              : {}),
                          }))
                        }
                      />
                      {label}
                    </label>
                  ))}
                </div>

                {productFormError ? (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 md:col-span-2">
                    {productFormError}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-gray-100 bg-gray-50 px-6 py-4">
              <button
                type="button"
                onClick={closeProductFormModal}
                disabled={isSaving}
                className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveProduct}
                disabled={isSaving}
                className="rounded-lg bg-[#ff6900] px-4 py-2 text-sm font-semibold text-white hover:bg-[#e55d00] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSaving ? 'Saving...' : editingProductId ? 'Update Product' : 'Add Product'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </LayoutClient>
  );
};

export default ProductsClient;
