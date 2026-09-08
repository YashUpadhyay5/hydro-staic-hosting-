import axios from "axios";

const getInvoiceApiBaseUrl = () => {
  if (import.meta.env && import.meta.env.VITE_API_URL) {
    return `${import.meta.env.VITE_API_URL}/v1/invoice`;
  }
  const hostname = window.location.hostname || '127.0.0.1';
  return `http://${hostname}:8000/api/v1/invoice`;
};

const API = axios.create({
  baseURL: getInvoiceApiBaseUrl(),
});

// Automatically inject token in request headers
API.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle global 401 Unauthorized responses to force logout
API.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401 && !window.location.pathname.includes("/login")) {
      localStorage.removeItem("token");
      localStorage.removeItem("username");
      window.location.href = "/login";
    }
    return Promise.reject(error);
  }
);

export default API;
