import { useEffect, useState } from "react";
import API from "../services/api";

export default function useDocuments() {
  const [documents, setDocuments] =
    useState([]);

  const loadDocuments = async () => {
    try {
      const response =
        await API.get("/documents");

      const raw = response.data;
      const docs = Array.isArray(raw) ? raw : (raw?.documents || raw?.data || []);
      setDocuments(docs);
    } catch (error) {
      console.error(error);
    }
  };

  useEffect(() => {
    loadDocuments();

    const interval =
      setInterval(loadDocuments, 5000);

    return () =>
      clearInterval(interval);
  }, []);

  return {
    documents,
    reloadDocuments: loadDocuments,
  };
}
