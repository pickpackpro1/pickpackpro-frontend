import React, { useEffect, useMemo, useState } from 'react';
import LayoutClient from './clientlayout/LayoutClient';
import LoadingState from '../common/LoadingState';
import FullPageLoader from '../common/FullPageLoader';
import {
  Search,
  Package,
  AlertTriangle,
  Truck,
  Eye,
  RefreshCw,
  X,
} from 'lucide-react';
import { getSession } from '../../utils/auth';
import {
  getProductActiveStatus,
  getProductDimensionParts,
  getProductDimensionsText,
  getProductFlags,
  getProductWeightText,
  getProductWeightValue,
} from '../../utils/productFields';

const API_BASE_URL = '';

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
    defaultFnsku: product?.defaultFnsku || product?.defaultFNSKU || product?.default_fnsku || '',
    lengthCm: dimensions.length,
    widthCm: dimensions.width,
    heightCm: dimensions.height,
    dimensionsText: getProductDimensionsText(product),
    active: getProductActiveStatus(product),
  };
};

const ProductsClient = () => {
  const [products, setProducts] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [showViewModal, setShowViewModal] = useState(false);
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

  const filteredProducts = useMemo(
    () =>
      products.filter((product) => {
        const term = searchQuery.toLowerCase();
        return (
          product.sku.toLowerCase().includes(term) ||
          product.productName.toLowerCase().includes(term)
        );
      }),
    [products, searchQuery]
  );

  const handleViewProduct = (product) => {
    setError('');
    setSelectedProduct(normalizeProduct(product));
    setShowViewModal(true);
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
            </div>
          </div>
        </div>
      ) : null}
    </LayoutClient>
  );
};

export default ProductsClient;
