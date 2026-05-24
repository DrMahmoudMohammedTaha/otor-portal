# OTOR Manager Backend API Documentation

Welcome to the **OTOR Manager API** documentation. This application is a backend service developed using FastAPI and SQLModel. It serves as the administrative portal and sheikh portal for the **OTOR AlQuran Quran Portal**, managing Quranic authorizations (Ejazas), student certifications, active print orders, local filesystem workflows, and expense tracking.

This document is written for developers (specifically junior engineers) to understand the codebase structure, database relationships, API operations, and how to run, configure, and secure the system.

---

## 1. Project Overview

The OTOR Manager API coordinates administrative tasks between two primary client user roles:
- **System Administrators (Admin)**: Full control over sheikh directories, managing student certificates, tracking print orders, starting shipping packages, local filesystem exploration, and logging financial transactions.
- **Sheikhs (Teachers)**: Access to their portal to view active student certificate request orders, check payment details, and track performance statistics.

### Architectural Blueprint
The project uses a lightweight single-process architecture optimized for desktop or intranet deployments on Windows environments, with capability for cloud postgresql hosting:
- **FastAPI Application Loop**: Listens for HTTP calls from various clients (Android apps, VB.NET desktop apps, or Web interfaces).
- **SQLModel Layer**: Unifies SQLAlchemy ORM declarations and Pydantic validation schemas in single classes, reducing data serialization boilerplate.
- **Local Integration System**: Interacts with the local Windows Explorer shell to orchestrate file directories for print templates.
- **Synchronization Hub**: Includes a sync system (`sync_databases.py`) that synchronizes changes between local systems and remote PostgreSQL servers.

---

## 2. Tech Stack & Dependencies

The backend stack is defined in [requirements.txt](file:///g:/sanad/sources/otor-portal/requirements.txt):

1. **FastAPI (`>=0.110.0`)**: 
   - A modern, high-performance web framework for building APIs with Python 3.8+ based on standard Python type hints.
   - Automatically generates OpenAPI and Swagger documentation (accessible at `/docs`).
2. **Uvicorn (`>=0.28.0`)**:
   - An ASGI (Asynchronous Server Gateway Interface) web server implementation for Python.
   - Run with standard reload features for fast local development.
3. **SQLModel (`>=0.0.16`)**:
   - A library designed by the creator of FastAPI to write SQL databases in Python using Python objects.
   - It integrates SQLAlchemy and Pydantic, meaning every database model is also a Pydantic validation model.
4. **psycopg2-binary (`>=2.9.9`)**:
   - PostgreSQL database adapter for Python. Essential for communicating with the production Neon PostgreSQL host.
5. **python-dotenv (`>=1.0.1`)**:
   - Reads key-value pairs from a `.env` file and sets them as environment variables.
   - Used to protect secret keys and database URLs.

---

## 3. Project Directory Structure

Here is the directory tree of the `otor-portal` backend service:

```
g:\sanad\sources\otor-portal\
│
├── .env                     # Local configuration and credentials (DATABASE_URL, passwords)
├── .env.example             # Template file demonstrating required env variables
├── .gitignore               # Excludes python build caches, log files, and keys from git
├── Dockerfile               # Setup for containerized deployments using Python 3.10
├── README.md                # Quick intro to the backend service
├── database.py              # Creates the database engine and the Session dependency
├── main.py                  # API endpoints, request validation, business logic, and security
├── models.py                # Table schemas representing SQLModel models
├── requirements.txt         # Required Python dependency packages
├── sync_databases.py        # Python script to sync local database instances with cloud PostgreSQL
├── sync_instructions.md     # Documentation outlining database sync routines
├── sync_snapshot.json       # Stores synchronization state hashes
└── static/                  # Static directory containing static assets and gallery images
    ├── index.html           # Simple index dashboard showing server status
    └── gallery/             # Subfolders containing template files for client previews
        ├── 1_ejaza/         # Quranic Ejaza previews
        ├── 2_background/    # Background design previews
        ├── 3_cover/         # Cover template previews
        ├── 4_certificate/   # Certificate previews
        ├── 5_tree/          # Sanad/Asaneed family tree layouts
        └── 6_stamp/         # Stamp and signature files
```

---

## 4. Setup & Installation

Follow these steps to run the application in a local development environment.

### Prerequisites
- Python 3.10 or higher installed.
- PostgreSQL database access (local instance or cloud provider like Neon.tech).

### Step 1: Clone and Create Virtual Environment
Navigate to the directory and initialize a Python virtual environment:
```powershell
cd g:\sanad\sources\otor-portal
python -m venv venv
```

### Step 2: Activate the Virtual Environment
- **Windows PowerShell**:
  ```powershell
  .\venv\Scripts\Activate.ps1
  ```
- **Windows CMD**:
  ```cmd
  .\venv\Scripts\activate.bat
  ```

### Step 3: Install Dependencies
```powershell
pip install -r requirements.txt
```

### Step 4: Configure Environment Variables
Create a file named `.env` in the root of `g:\sanad\sources\otor-portal` with the following configuration:
```ini
DATABASE_URL=postgresql://user:password@hostname:5432/dbname?sslmode=require
ADMIN_PASSWORD=admin123
```
*(Replace `DATABASE_URL` with your target database connection string).*

### Step 5: Start the Uvicorn Server
Launch the server using Uvicorn with auto-reload enabled:
```powershell
python main.py
```
Alternatively:
```powershell
uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```
The interactive API documentation will be available at:
- Swagger UI: [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)
- ReDoc: [http://127.0.0.1:8000/redoc](http://127.0.0.1:8000/redoc)

---

## 5. Core Modules & Architecture Detailed Breakdown

Data flows through the system in a standard REST routing architecture:

```
[HTTP Client] 
     │ (JSON/HTTP)
     ▼
[main.py (FastAPI Routers + Input Validation)]
     │ (Checks Auth Dependency in Header)
     ▼
[database.py (get_session dependency yields DB Session)]
     │ (Runs SQL Queries / Model operations)
     ▼
[models.py (SQLModel Schemas mapped to PostgreSQL Tables)]
     │ (Commit / Transaction)
     ▼
[Database Engine (PostgreSQL / SQLite)]
```

### Detailed Component Analysis

#### A. Database Initialization (`database.py`)
This module initializes the SQLAlchemy database connection engine. It reads the `DATABASE_URL` environment variable loaded by `python-dotenv`.
It exports `get_session()`, which is a generator function decorated with FastAPI’s `Depends`. It opens a database session for each request, yields it to the route function, and automatically closes it when the request is finalized.

#### B. Model Architecture (`models.py`)
This file defines the structural representations of the tables. Because it uses `SQLModel`, there is no separation between DB Schemas and API Models. If a property is marked as `table=True`, it maps to a physical database table.

#### C. API Router & App Entry (`main.py`)
This is the heart of the application containing all HTTP routes. It configures:
- **CORS Middleware**: Allows incoming requests from arbitrary sources (`*`), enabling smooth local communication with mobile devices and visual basic applications.
- **Dependency Injections**: Checks for admin tokens (`verify_admin`).
- **File System Utilities**: Launches directories on the host operating system.
- **Gallery Explorers**: Dynamically lists catalog folders in the local static directory and feeds them back as JSON.

---

## 6. Database & Models

Here is a breakdown of the tables and how they map inside [models.py](file:///g:/sanad/sources/otor-portal/models.py):

| Class name | Table Name | Key Purpose | Primary Fields |
| :--- | :--- | :--- | :--- |
| `Sheikh` | `sheikh` | Details of registered teachers. | `id` (PK), `name` (unique identifier), `gender` (boolean), `phone`, `city` |
| `Orders` | `orders` | Contains active certificates orders. | `id` (PK), `state` (NEXT/DESIGN/PRINT/POST/DELIVER), `sheikh_id` (FK), `cost`, `paid`, `rest` |
| `Content` | `content` | Individual certificate content details. | `id` (PK), `order_id` (logical link), `student_name`, `qeraa` (reading format) |
| `Expenses` | `expenses` | General business expense logger. | `id` (PK), `expense`, `amount`, `category` |
| `Money` | `money` | Secondary monetary ledger. | `id` (PK), `expense`, `amount`, `due_date` |
| `Package` | `package` | Tracks shipping parcel batch times. | `id` (PK), `start_date`, `end_date`, `post_cost` |
| `OrderHistory`| `order_history`| Archived record of completed orders. | `id` (PK), `state` (fixed to "DONE"), `cost`, `paid`, `rest` (must be 0) |

### Design Decisions & Relationships
- **Logical Links instead of DB constraints**: The `Content` table's `order_id` is a logical index without hard foreign key constraints. This is because a content item can belong to either an active order (`orders` table) or an archived history order (`order_history` table). When an order is completed, it is moved from `orders` to `order_history`; logical linking avoids cascade deletion of associated student certificates.
- **Manual ID Generation (`get_next_id` in `main.py`)**: To avoid database autoincrement sequence conflicts (which frequently occur when syncing local SQLite instances with production cloud Postgres tables), primary keys are calculated on insertion using:
  ```python
  def get_next_id(session: Session, table_name: str) -> int:
      statement = text(f"SELECT COALESCE(MAX(id), 0) + 1 FROM {table_name}")
      return session.execute(statement).scalar()
  ```

---

## 7. Authentication & Security

This system implements a simple but robust static session-token auth model optimized for secure intranets.

### Admin Authentication Dependency
API routes that mutate records (such as creating sheikhs, deleting orders, or running system folder utilities) require administrative privileges. This is implemented via a dependency helper function `verify_admin`:

```python
def verify_admin(authorization: Optional[str] = Header(None)):
    if not authorization or authorization != "Bearer admin-session-token":
        raise HTTPException(
            status_code=403, 
            detail="Administrative authorization credentials required"
        )
```

In routes, this dependency is attached either directly to the path decorator or inside the route parameters:
```python
@app.post("/api/sheikhs", response_model=Sheikh, dependencies=[Depends(verify_admin)])
def create_sheikh(sheikh: Sheikh, session: Session = Depends(get_session)):
    # Code executes only if "Authorization: Bearer admin-session-token" is supplied
```

### Role-Based Access Control
- **Admin**: Generates a token `"admin-session-token"` on login. Can perform all operations.
- **Sheikh**: Generates a token `"sheikh-session-token-{sheikh_id}"` on login. Can query orders filtering specifically by their own `sheikh_id`.

---

## 8. API Endpoint Reference

### A. Authentication
#### 1. Login User
Authenticates a user based on role credentials.
- **HTTP Method**: `POST`
- **URL Path**: `/api/auth/login`
- **Request Body Schema (`LoginRequest`)**:
  ```json
  {
    "role": "admin",
    "password": "admin123",
    "phone": null
  }
  ```
- **Successful Response (Status 200 OK)**:
  - Admin:
    ```json
    {
      "token": "admin-session-token",
      "role": "admin",
      "name": "System Administrator",
      "sheikh_id": null
    }
    ```
  - Sheikh (Authenticates by matching registered `phone` number):
    ```json
    {
      "token": "sheikh-session-token-1",
      "role": "sheikh",
      "name": "Sheikh Ahmad",
      "sheikh_id": 1
    }
    ```
- **Error Responses**:
  - `401 Unauthorized`: "Invalid admin password" or "Phone number is not registered."
  - `400 Bad Request`: "Phone number is required" or "Invalid role specified."

---

### B. Sheikhs Management
#### 1. List Sheikhs
Retrieves all registered Sheikhs with optional search filtering.
- **HTTP Method**: `GET`
- **URL Path**: `/api/sheikhs`
- **Query Parameters**:
  - `search` (string, optional): Search term that filters by name, phone, or city. Performs robust normalized Arabic search.
- **Successful Response (Status 200 OK)**:
  ```json
  [
    {
      "id": 1,
      "name": "الشيخ عبد الله",
      "info": "مدرس التجويد والقراءات",
      "comment": null,
      "gender": true,
      "receiver_name": "عبد الله محمد",
      "phone": "01015192541",
      "country": "مصر",
      "city": "القاهرة",
      "address": "وسط البلد",
      "insert_date": "2026-05-24T14:18:45"
    }
  ]
  ```

#### 2. Get Sheikh Stats
Fetches statistics of historical work completed by a specific Sheikh.
- **HTTP Method**: `GET`
- **URL Path**: `/api/sheikhs/{id}/stats`
- **Path Parameters**:
  - `id` (integer, required): Unique identifier of the Sheikh.
- **Successful Response (Status 200 OK)**:
  ```json
  {
    "sheikh_id": 1,
    "name": "الشيخ عبد الله",
    "total_historical_cost": 1500.0,
    "total_historical_items": 15,
    "active_orders_count": 2
  }
  ```
- **Error Responses**:
  - `404 Not Found`: "Sheikh not found"

---

### C. Active Print Orders
#### 1. List Active Orders
Returns currently active print orders sorted by urgency (`degree` rank ascending, `rest` outstanding payment descending).
- **HTTP Method**: `GET`
- **URL Path**: `/api/orders`
- **Query Parameters**:
  - `state` (string, default `"ALL"`): Filters by state (`NEXT`, `DESIGN`, `PRINT`, `POST`, `DELIVER`).
  - `sheikh_id` (integer, optional): Filters active orders belonging to a specific Sheikh.
  - `search` (string, optional): Searches in-memory for name, phone, city, or content.
- **Successful Response (Status 200 OK)**:
  ```json
  [
    {
      "id": 5,
      "state": "PRINT",
      "sheikh_id": 1,
      "sheikh_name": "الشيخ عبد الله",
      "comment": "عاجل جداً",
      "contents": "إجازة بقراءة عاصم",
      "cost": 500.0,
      "paid": 300.0,
      "rest": 200.0,
      "p_receiver": "أحمد سعيد",
      "p_phone": "01011223344",
      "p_country": "مصر",
      "p_city": "القاهرة",
      "p_address": "العتبة",
      "insert_date": "2026-05-20T10:00:00",
      "update_date": "2026-05-24T12:00:00",
      "degree": 1.0,
      "sheikh_phone": "01015192541",
      "sheikh_city": "القاهرة"
    }
  ]
  ```

#### 2. Update Order State (Workflow Coercion)
Updates the status workflow of a print order. Handles archiving logic upon transition to `DONE`.
- **HTTP Method**: `PUT`
- **URL Path**: `/api/orders/{id}/state`
- **Path Parameters**:
  - `id` (integer, required): Active order ID.
- **Request Body**:
  ```json
  {
    "state": "DONE"
  }
  ```
- **Successful Response (Status 200 OK)**:
  - If the order has unpaid balances (`rest` > 0), the system rejects archiving and coerces the status to `DELIVER` to prevent unpaid archive leaks:
    ```json
    {
      "status": "state_coerced_to_deliver",
      "order": { ... }
    }
    ```
  - If the order is fully paid (`rest` <= 0), it is removed from active orders and archived into history:
    ```json
    {
      "status": "archived",
      "id": 5
    }
    ```

---

### D. Certificate Content Items
#### 1. Bulk Import Content Lines
Enables bulk adding of student certificate data details from plain text.
- **HTTP Method**: `POST`
- **URL Path**: `/api/content/bulk`
- **Request Headers**: `Authorization: Bearer admin-session-token`
- **Request Body (`BulkContentInput`)**:
  ```json
  {
    "order_id": 5,
    "raw_text": "محمود طه - ذكر - عاصم عن الكوفة - الشاطبية\nعائشة أحمد - أنثى - ابن كثير المكي - التيسير"
  }
  ```
- **Business Logic parsing rules**: Splits plain text lines by newline (`\n`), then parses column variables by separating columns with the hyphen operator (`-`).
- **Successful Response (Status 200 OK)**:
  ```json
  {
    "inserted_count": 2
  }
  ```

---

### E. System Operations
#### 1. Open Local File System Directory
Creates and launches local system folders for printing template catalogs using host command utilities.
- **HTTP Method**: `POST`
- **URL Path**: `/api/system/open-folder`
- **Request Headers**: `Authorization: Bearer admin-session-token`
- **Request Body (`FolderOpenRequest`)**:
  ```json
  {
    "sheikh_name": "عبد الله محمد"
  }
  ```
- **System Behavior**:
  1. Concatenates the variable path to local host storage: `G:\sheikh\عبد الله محمد`.
  2. If the folder path does not exist, the API runs `os.makedirs` to create it.
  3. Executes `subprocess.Popen('explorer.exe "G:\sheikh\عبد الله محمد"')` to spawn a Windows Explorer file GUI screen for the admin user.
- **Successful Response (Status 200 OK)**:
  ```json
  {
    "status": "opened",
    "path": "G:\\sheikh\\عبد الله محمد"
  }
  ```
- **Error Responses**:
  - `500 Internal Server Error`: "Could not create local directory" or "Failed to launch explorer."
