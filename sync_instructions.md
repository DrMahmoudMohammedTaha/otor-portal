# Database Synchronization Guide

This guide explains how to run the bidirectional database synchronization script that connects your local Microsoft Access database (`G:\otor_be.accdb`) and the remote Neon PostgreSQL database.

---

## Option 1: Using the Interactive Batch Menu (Recommended)

A helper script named `run_sync.bat` is located at the root of your `G:\` drive.

1. Open **File Explorer** and navigate to your `G:\` drive.
2. Double-click the file named **`run_sync.bat`**.
3. Choose one of the options by typing its number and pressing **Enter**:
   * **`[1] Dry Run`**: Previews all additions, updates, and deletions on both sides safely without saving any changes.
   * **`[2] Live Sync`**: Merges new inserts and updates bidirectionally. *Does not propagate deletions.*
   * **`[3] Live Sync with Deletions`**: Merges all changes and propagates deletions bidirectionally (asks for verification before running).
   * **`[4] Exit`**: Closes the application.

---

## Option 2: Running via Terminal / Command Prompt

You can run the script manually from the terminal where your Python environment is set up.

1. Open **Command Prompt** (cmd) or **PowerShell**.
2. Navigate to the project directory:
   ```cmd
   cd /d "G:\sanad\sources\P_otor_portal\otor-portal"
   ```
3. Execute the Python script using one of the following commands:

   ### A. Dry Run / Safety Preview
   To simulate the sync and see what changes *would* be made without modifying either database:
   ```cmd
   python sync_databases.py --dry-run
   ```

   ### B. Bidirectional Sync (Safe Mode)
   To sync updates and new records bidirectionally (does NOT sync deletions):
   ```cmd
   python sync_databases.py
   ```

   ### C. Full Bidirectional Sync (Including Deletions)
   To sync all additions, updates, and propagate deleted rows:
   ```cmd
   python sync_databases.py --delete-missing
   ```

---

## Technical Details

* **Script Location:** `G:\sanad\sources\P_otor_portal\otor-portal\sync_databases.py`
* **Access DB Path:** `G:\otor_be.accdb`
* **Sync Configuration/Snapshot File:** `G:\sanad\sources\P_otor_portal\otor-portal\sync_snapshot.json` (Tracks deletions dynamically)
