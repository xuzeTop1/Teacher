"""PyInstaller entry point wrapper for document_worker.

This wrapper allows PyInstaller to properly resolve relative imports
when打包为 onefile exe. It is NOT used during development.
"""
import sys
import os

# Ensure the package is importable
if getattr(sys, 'frozen', False):
    # Running as PyInstaller bundle
    sys.path.insert(0, os.path.dirname(sys.executable))

from document_worker.__main__ import main

if __name__ == "__main__":
    main()
