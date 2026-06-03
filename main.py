import os
import subprocess
from datetime import datetime
from typing import List, Optional
from fastapi import FastAPI, Depends, HTTPException, Query, Header
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import Session, select, func, text, and_
from pydantic import BaseModel

# Import local configuration and models
from database import get_session, engine
from models import Sheikh, Orders, Content, Expenses, Money, Package, OrderHistory, Qari, QariEgaza

app = FastAPI(
    title="OTOR Manager API",
    description="Backend API for OTOR AlQuran Quran Portal with Role-Based Access Control.",
    version="1.1"
)

# Enable CORS for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Load Admin and Sanad credentials
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "admin123")
SANAD_PASSWORD = os.getenv("SANAD_PASSWORD", "sanad123")

# Base path for local system sheikh folders
SHEIKH_BASE_PATH = r"G:\sheikh"

# ==========================================
# Authentication Payloads & Helpers
# ==========================================
class LoginRequest(BaseModel):
    role: str  # "admin", "sheikh" or "sanad"
    password: Optional[str] = None
    phone: Optional[str] = None

class BulkContentInput(BaseModel):
    order_id: int
    raw_text: str  # Format: STUDENT_NAME - STUDENT_GENDER - STUDENT_INFO - QERAA

class OrderStateUpdate(BaseModel):
    state: str

class FolderOpenRequest(BaseModel):
    sheikh_name: str

# Dependency to enforce Admin permissions
def verify_admin(authorization: Optional[str] = Header(None)):
    if not authorization or authorization != "Bearer admin-session-token":
        raise HTTPException(
            status_code=403, 
            detail="Administrative authorization credentials required"
        )

# Dependency to enforce Sanad or Admin permissions
def verify_sanad_or_admin(authorization: Optional[str] = Header(None)):
    if not authorization or authorization not in ("Bearer admin-session-token", "Bearer sanad-session-token"):
        raise HTTPException(
            status_code=403, 
            detail="Sanad Explorer or Administrative authorization credentials required"
        )

# Helper to generate the next integer primary key for non-serial tables
def get_next_id(session: Session, table_name: str) -> int:
    statement = text(f"SELECT COALESCE(MAX(id), 0) + 1 FROM {table_name}")
    return session.execute(statement).scalar()

# Helper to sync order cost and rest fields based on content records
def sync_order_cost(order_id: int, session: Session):
    content_cost_sum = session.execute(
        text("SELECT COALESCE(SUM(cost * COALESCE(amount, 1)), 0.0) FROM content WHERE order_id = :order_id"),
        {"order_id": order_id}
    ).scalar() or 0.0
    
    session.execute(
        text("UPDATE orders SET cost = :cost, rest = :cost - paid, update_date = :now WHERE id = :order_id"),
        {"cost": content_cost_sum, "now": datetime.now(), "order_id": order_id}
    )
    session.commit()

# ==========================================
# Authentication Endpoints
# ==========================================
@app.post("/api/auth/login")
def login(payload: LoginRequest, session: Session = Depends(get_session)):
    try:
        role = payload.role.lower()
        
        if role == "admin":
            if payload.password == ADMIN_PASSWORD:
                return {
                    "token": "admin-session-token",
                    "role": "admin",
                    "name": "System Administrator",
                    "sheikh_id": None
                }
            raise HTTPException(status_code=401, detail="Invalid admin password.")
            
        elif role == "sanad":
            if payload.password == SANAD_PASSWORD:
                return {
                    "token": "sanad-session-token",
                    "role": "sanad",
                    "name": "Sanad Explorer Operator",
                    "sheikh_id": None
                }
            raise HTTPException(status_code=401, detail="Invalid sanad passcode.")
            
        elif role == "sheikh":
            if not payload.phone or not payload.phone.strip():
                raise HTTPException(status_code=400, detail="Phone number is required.")
            
            phone_stripped = payload.phone.strip()
            # Query sheikh table matching phone number
            query = select(Sheikh).where(Sheikh.phone == phone_stripped)
            sheikh = session.exec(query).first()
            
            # Fallback search matching with trailing or leading matches if exact match fails
            if not sheikh:
                query_fuzzy = select(Sheikh).where(Sheikh.phone.like(f"%{phone_stripped}%"))
                sheikh = session.exec(query_fuzzy).first()
                
            if sheikh:
                return {
                    "token": f"sheikh-session-token-{sheikh.id}",
                    "role": "sheikh",
                    "name": sheikh.name,
                    "sheikh_id": sheikh.id
                }
                
            raise HTTPException(status_code=401, detail="Phone number is not registered.")
            
        raise HTTPException(status_code=400, detail="Invalid role specified.")
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        tb = traceback.format_exc()
        raise HTTPException(status_code=500, detail=f"Login internal error: {str(e)}\n{tb}")


# Helper to normalize Arabic letters for robust search
def normalize_arabic_str(s: str) -> str:
    if not s:
        return ""
    # Normalize Hamzas
    s = s.replace("أ", "ا").replace("إ", "ا").replace("آ", "ا")
    # Normalize Ta Marbuta
    s = s.replace("ة", "ه")
    # Normalize Alef Maksura
    s = s.replace("ى", "ي")
    return s

# ==========================================
# API Routes: Sheikhs
# ==========================================
@app.get("/api/sheikhs")
def list_sheikhs(
    search: Optional[str] = None,
    session: Session = Depends(get_session)
):
    query = text("""
        SELECT 
            s.id, s.name, s.info, s.comment, s.gender, s.receiver_name, s.phone, s.country, s.city, s.address, s.insert_date,
            COALESCE(
                (SELECT SUM(
                    COALESCE((SELECT SUM(c.cost * COALESCE(c.amount, 1)) FROM content c WHERE c.order_id = o.id), 0.0) - o.paid
                ) FROM orders o WHERE o.sheikh_id = s.id),
                0.0
            ) AS balance,
            COALESCE(
                (SELECT COUNT(*) FROM content c WHERE c.order_id IN (
                    SELECT id FROM order_history WHERE sheikh_id = s.id OR sheikh_name = s.name
                )),
                0
            ) AS plates
        FROM sheikh s
        ORDER BY s.name;
    """)
    
    rows = session.execute(query).fetchall()
    
    results = []
    for r in rows:
        if search:
            search_norm = normalize_arabic_str(search).lower()
            name_norm = normalize_arabic_str(r[1] or "").lower()
            phone_norm = normalize_arabic_str(r[6] or "").lower()
            city_norm = normalize_arabic_str(r[8] or "").lower()
            if (search_norm not in name_norm and
                search_norm not in phone_norm and
                search_norm not in city_norm):
                continue
                
        results.append({
            "id": r[0],
            "name": r[1],
            "info": r[2],
            "comment": r[3],
            "gender": r[4],
            "receiver_name": r[5],
            "phone": r[6],
            "country": r[7],
            "city": r[8],
            "address": r[9],
            "insert_date": r[10],
            "balance": float(r[11]) if r[11] is not None else 0.0,
            "plates": int(r[12]) if r[12] is not None else 0,
            "price": 65.0
        })
        
    return results

@app.get("/api/sheikhs/{id}", response_model=Sheikh)
def get_sheikh(id: int, session: Session = Depends(get_session)):
    sheikh = session.get(Sheikh, id)
    if not sheikh:
        raise HTTPException(status_code=404, detail="Sheikh not found")
    return sheikh


@app.get("/api/sheikhs/{id}/stats")
def get_sheikh_stats(id: int, session: Session = Depends(get_session)):
    sheikh = session.get(Sheikh, id)
    if not sheikh:
        raise HTTPException(status_code=404, detail="Sheikh not found")
    
    # 1. Total cost from completed orders (ORDER_HISTORY)
    history_cost = session.execute(
        text("SELECT COALESCE(SUM(cost), 0.0) FROM order_history WHERE sheikh_id = :id OR sheikh_name = :name"),
        {"id": id, "name": sheikh.name}
    ).scalar() or 0.0
    
    # 2. Total items count (from CONTENT where order_id in order_history)
    items_count = session.execute(
        text("""
            SELECT COUNT(*) FROM content 
            WHERE order_id IN (
                SELECT id FROM order_history WHERE sheikh_id = :id OR sheikh_name = :name
            )
        """),
        {"id": id, "name": sheikh.name}
    ).scalar() or 0
    
    # 3. Active orders count
    active_count = session.execute(
        text("SELECT COUNT(*) FROM orders WHERE sheikh_id = :id"),
        {"id": id}
    ).scalar() or 0

    # 4. Remaining Balance (sum of rest from active orders calculated dynamically)
    balance = session.execute(
        text("""
            SELECT COALESCE(SUM(
                COALESCE((SELECT SUM(c.cost * COALESCE(c.amount, 1)) FROM content c WHERE c.order_id = o.id), 0.0) - o.paid
            ), 0.0)
            FROM orders o
            WHERE o.sheikh_id = :id
        """),
        {"id": id}
    ).scalar() or 0.0

    return {
        "sheikh_id": id,
        "name": sheikh.name,
        "total_historical_cost": history_cost,
        "total_historical_items": items_count,
        "active_orders_count": active_count,
        # compatibility fields for mobile app
        "active_count": active_count,
        "earned": history_cost,
        "plates": items_count,
        "balance": balance
    }

@app.post("/api/sheikhs", response_model=Sheikh, dependencies=[Depends(verify_admin)])
def create_sheikh(sheikh: Sheikh, session: Session = Depends(get_session)):
    sheikh.id = get_next_id(session, "sheikh")
    sheikh.insert_date = datetime.now()
    session.add(sheikh)
    session.commit()
    session.refresh(sheikh)
    return sheikh

@app.put("/api/sheikhs/{id}", response_model=Sheikh, dependencies=[Depends(verify_admin)])
def update_sheikh(id: int, updated_sheikh: Sheikh, session: Session = Depends(get_session)):
    sheikh = session.get(Sheikh, id)
    if not sheikh:
        raise HTTPException(status_code=404, detail="Sheikh not found")
    
    name_changed = (sheikh.name != updated_sheikh.name)

    # Update sheikh details
    for key, value in updated_sheikh.model_dump(exclude={"id", "insert_date"}).items():
        setattr(sheikh, key, value)
        
    session.add(sheikh)
    
    if name_changed:
        session.execute(
            text("UPDATE orders SET sheikh_name = :new_name WHERE sheikh_id = :id"),
            {"new_name": sheikh.name, "id": id}
        )
        
    session.commit()
    session.refresh(sheikh)
    return sheikh

@app.delete("/api/sheikhs/{id}", dependencies=[Depends(verify_admin)])
def delete_sheikh(id: int, session: Session = Depends(get_session)):
    sheikh = session.get(Sheikh, id)
    if not sheikh:
        raise HTTPException(status_code=404, detail="Sheikh not found")
    session.delete(sheikh)
    session.commit()
    return {"detail": "Sheikh deleted successfully"}

# ==========================================
# API Routes: Orders (Active)
# ==========================================
@app.get("/api/orders")
def list_orders(
    state: str = "ALL", 
    sheikh_id: Optional[int] = None,  # Filter for role-based view
    search: Optional[str] = None,
    session: Session = Depends(get_session)
):
    sql_query = """
        SELECT 
            o.id, o.state, o.sheikh_id, o.sheikh_name, o.comment, o.contents, o.paid, o.p_receiver, o.p_phone, o.p_country, o.p_city, o.p_address, o.insert_date, o.update_date, o.degree,
            s.phone AS sheikh_phone,
            s.city AS sheikh_city,
            COALESCE(c.cost_sum, 0.0) AS calculated_cost
        FROM orders o
        LEFT JOIN sheikh s ON o.sheikh_id = s.id
        LEFT JOIN (
            SELECT order_id, SUM(cost * COALESCE(amount, 1.0)) AS cost_sum
            FROM content
            GROUP BY order_id
        ) c ON c.order_id = o.id
        WHERE 1=1
    """
    params = {}
    if state != "ALL":
        sql_query += " AND o.state = :state"
        params["state"] = state
    if sheikh_id:
        sql_query += " AND o.sheikh_id = :sheikh_id"
        params["sheikh_id"] = sheikh_id
        
    sql_query += " ORDER BY o.degree, (COALESCE(c.cost_sum, 0.0) - o.paid) DESC, o.insert_date"
    
    rows = session.execute(text(sql_query), params).fetchall()
    
    orders_with_sheikh = []
    for r in rows:
        calculated_cost = float(r[17])
        paid = float(r[6]) if r[6] is not None else 0.0
        
        # Apply search filtering in memory if query is provided
        if search:
            search_norm = normalize_arabic_str(search).lower()
            name_norm = normalize_arabic_str(r[3] or "").lower()
            phone_norm = normalize_arabic_str(r[8] or (r[15] or "")).lower()
            city_norm = normalize_arabic_str(r[10] or (r[16] or "")).lower()
            content_norm = normalize_arabic_str(r[5] or "").lower()
            
            if (search_norm not in name_norm and
                search_norm not in phone_norm and
                search_norm not in city_norm and
                search_norm not in content_norm):
                continue
                
        orders_with_sheikh.append({
            "id": r[0],
            "state": r[1],
            "sheikh_id": r[2],
            "sheikh_name": r[3],
            "comment": r[4],
            "contents": r[5],
            "cost": calculated_cost,
            "paid": paid,
            "rest": calculated_cost - paid,
            "p_receiver": r[7],
            "p_phone": r[8],
            "p_country": r[9],
            "p_city": r[10],
            "p_address": r[11],
            "insert_date": r[12],
            "update_date": r[13],
            "degree": r[14],
            "sheikh_phone": r[15] or "",
            "sheikh_city": r[16] or ""
        })
        
    return orders_with_sheikh


@app.get("/api/orders/history")
def list_order_history(
    sheikh_id: Optional[int] = None,
    search: Optional[str] = None,
    session: Session = Depends(get_session)
):
    query = select(OrderHistory)
    if sheikh_id:
        query = query.where(OrderHistory.sheikh_id == sheikh_id)
    query = query.order_by(OrderHistory.update_date.desc())
    history_list = session.exec(query).all()
    
    if search:
        search_norm = normalize_arabic_str(search).lower()
        filtered = []
        for o in history_list:
            name_norm = normalize_arabic_str(o.sheikh_name or "").lower()
            phone_norm = normalize_arabic_str(o.p_phone or "").lower()
            city_norm = normalize_arabic_str(o.p_city or "").lower()
            content_norm = normalize_arabic_str(o.contents or "").lower()
            if (search_norm in name_norm or 
                search_norm in phone_norm or 
                search_norm in city_norm or 
                search_norm in content_norm):
                filtered.append(o)
        return filtered
        
    return history_list

@app.get("/api/orders/{id}")
def get_order_details(id: int, session: Session = Depends(get_session)):
    order = session.get(Orders, id)
    if not order:
        hist = session.get(OrderHistory, id)
        if hist:
            return {"archived": True, "order": hist.model_dump(), "sheikh": None}
        raise HTTPException(status_code=404, detail="Order not found")
    
    sheikh = session.get(Sheikh, order.sheikh_id) if order.sheikh_id else None
    
    # Calculate dynamically
    content_cost_sum = float(session.execute(
        text("SELECT COALESCE(SUM(cost * COALESCE(amount, 1)), 0.0) FROM content WHERE order_id = :order_id"),
        {"order_id": order.id}
    ).scalar() or 0.0)
    
    order_dict = order.model_dump()
    order_dict["cost"] = content_cost_sum
    order_dict["rest"] = content_cost_sum - (order.paid or 0.0)
    
    return {
        "archived": False,
        "order": order_dict,
        "sheikh": sheikh
    }

@app.post("/api/orders", response_model=Orders, dependencies=[Depends(verify_admin)])
def create_order(order: Orders, session: Session = Depends(get_session)):
    order.id = get_next_id(session, "orders")
    order.insert_date = datetime.now()
    order.update_date = datetime.now()
    
    order.rest = (order.cost or 0.0) - (order.paid or 0.0)
    
    if order.sheikh_id and not order.sheikh_name:
        sheikh = session.get(Sheikh, order.sheikh_id)
        if sheikh:
            order.sheikh_name = sheikh.name
            if not order.p_receiver:
                order.p_receiver = sheikh.receiver_name or sheikh.name
            if not order.p_phone:
                order.p_phone = sheikh.phone
            if not order.p_country:
                order.p_country = sheikh.country
            if not order.p_city:
                order.p_city = sheikh.city
            if not order.p_address:
                order.p_address = sheikh.address
                
    session.add(order)
    session.commit()
    
    # Auto default content row
    content_id = get_next_id(session, "content")
    default_content = Content(
        id=content_id,
        order_id=order.id,
        type="OTHER",
        amount=1.0,
        cost=0.0
    )
    session.add(default_content)
    session.commit()
    
    # Sync order cost dynamically
    sync_order_cost(order.id, session)
    
    session.refresh(order)
    return order

@app.put("/api/orders/{id}", response_model=Orders, dependencies=[Depends(verify_admin)])
def update_order(id: int, updated_order: Orders, session: Session = Depends(get_session)):
    order = session.get(Orders, id)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    
    for key, value in updated_order.model_dump(exclude={"id", "insert_date"}).items():
        setattr(order, key, value)
        
    order.update_date = datetime.now()
    
    if order.sheikh_id:
        sheikh = session.get(Sheikh, order.sheikh_id)
        if sheikh:
            order.sheikh_name = sheikh.name
            
    session.add(order)
    session.commit()
    
    # Sync cost and rest to database
    sync_order_cost(id, session)
    
    session.refresh(order)
    return order

@app.put("/api/orders/{id}/state", dependencies=[Depends(verify_admin)])
def update_order_state(id: int, payload: OrderStateUpdate, session: Session = Depends(get_session)):
    order = session.get(Orders, id)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    
    new_state = payload.state.upper()
    order.update_date = datetime.now()
    
    if new_state == "DONE":
        if (order.rest or 0.0) > 0.0:
            order.state = "DELIVER"
            session.add(order)
            session.commit()
            session.refresh(order)
            return {"status": "state_coerced_to_deliver", "order": order}
        else:
            hist_id = order.id
            history_entry = OrderHistory(
                id=hist_id,
                state="DONE",
                sheikh_id=order.sheikh_id,
                sheikh_name=order.sheikh_name,
                comment=order.comment,
                contents=order.contents,
                cost=order.cost,
                paid=order.paid,
                rest=order.rest,
                p_receiver=order.p_receiver,
                p_phone=order.p_phone,
                p_country=order.p_country,
                p_city=order.p_city,
                p_address=order.p_address,
                insert_date=order.insert_date,
                update_date=datetime.now(),
                degree=order.degree
            )
            session.add(history_entry)
            session.delete(order)
            session.commit()
            return {"status": "archived", "id": hist_id}
            
    order.state = new_state
    session.add(order)
    session.commit()
    session.refresh(order)
    return {"status": "updated", "order": order}

@app.delete("/api/orders/{id}", dependencies=[Depends(verify_admin)])
def delete_order(id: int, session: Session = Depends(get_session)):
    order = session.get(Orders, id)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
        
    session.execute(
        text("DELETE FROM content WHERE order_id = :order_id"),
        {"order_id": id}
    )
    
    session.delete(order)
    session.commit()
    return {"detail": f"Order {id} and its content items deleted successfully."}

# ==========================================
# API Routes: Contents (Order Items)
# ==========================================
@app.get("/api/content", response_model=List[Content])
def list_content(order_id: int, session: Session = Depends(get_session)):
    query = select(Content).where(Content.order_id == order_id).order_by(Content.id)
    return session.exec(query).all()

@app.post("/api/content", response_model=Content, dependencies=[Depends(verify_admin)])
def create_content(content: Content, session: Session = Depends(get_session)):
    content.id = get_next_id(session, "content")
    session.add(content)
    session.commit()
    session.refresh(content)
    if content.order_id:
        sync_order_cost(content.order_id, session)
    return content

@app.put("/api/content/{id}", response_model=Content, dependencies=[Depends(verify_admin)])
def update_content(id: int, updated_content: Content, session: Session = Depends(get_session)):
    content = session.get(Content, id)
    if not content:
        raise HTTPException(status_code=404, detail="Content item not found")
        
    for key, value in updated_content.model_dump(exclude={"id"}).items():
        setattr(content, key, value)
        
    session.add(content)
    session.commit()
    session.refresh(content)
    if content.order_id:
        sync_order_cost(content.order_id, session)
    return content

@app.delete("/api/content/{id}", dependencies=[Depends(verify_admin)])
def delete_content(id: int, session: Session = Depends(get_session)):
    content = session.get(Content, id)
    if not content:
        raise HTTPException(status_code=404, detail="Content item not found")
    order_id = content.order_id
    session.delete(content)
    session.commit()
    if order_id:
        sync_order_cost(order_id, session)
    return {"detail": "Content item deleted successfully"}

@app.post("/api/content/bulk", dependencies=[Depends(verify_admin)])
def bulk_insert_content(payload: BulkContentInput, session: Session = Depends(get_session)):
    order = session.get(Orders, payload.order_id)
    if not order:
        hist = session.get(OrderHistory, payload.order_id)
        if not hist:
            raise HTTPException(status_code=404, detail="Order not found")
            
    lines = payload.raw_text.strip().split("\n")
    inserted_count = 0
    
    for line in lines:
        if not line.strip():
            continue
            
        parts = [p.strip() for p in line.split("-")]
        
        student_name = parts[0] if len(parts) > 0 else "Unknown"
        student_gender = parts[1] if len(parts) > 1 else ""
        student_info = parts[2] if len(parts) > 2 else ""
        qeraa = parts[3] if len(parts) > 3 else ""
        
        content_id = get_next_id(session, "content")
        new_item = Content(
            id=content_id,
            order_id=payload.order_id,
            type="EJAZA",
            student_name=student_name,
            student_gender=student_gender,
            student_info=student_info,
            qeraa=qeraa,
            amount=1.0,
            cost=0.0
        )
        session.add(new_item)
        inserted_count += 1
        
    session.commit()
    sync_order_cost(payload.order_id, session)
    return {"inserted_count": inserted_count}

# ==========================================
# API Routes: Expenses & Money
# ==========================================
@app.get("/api/expenses")
def list_expenses(
    category: Optional[str] = None,
    session: Session = Depends(get_session)
):
    query = select(Expenses)
    if category:
        query = query.where(Expenses.category == category)
    query = query.order_by(Expenses.due_date.desc())
    return session.exec(query).all()

@app.get("/api/expenses/categories")
def get_expenses_categories(session: Session = Depends(get_session)):
    results = session.execute(
        text("SELECT category, SUM(amount) as total FROM expenses GROUP BY category ORDER BY total DESC")
    ).fetchall()
    return [{"category": r[0], "total": float(r[1])} for r in results]

@app.post("/api/expenses", response_model=Expenses, dependencies=[Depends(verify_admin)])
def create_expense(expense: Expenses, session: Session = Depends(get_session)):
    expense.due_date = expense.due_date or datetime.now()
    session.add(expense)
    session.commit()
    session.refresh(expense)
    return expense

# ==========================================
# API Routes: Package Status
# ==========================================
@app.get("/api/package/status")
def get_package_status(session: Session = Depends(get_session)):
    latest_package = session.exec(
        select(Package).order_by(Package.start_date.desc())
    ).first()
    
    if not latest_package or not latest_package.start_date:
        return {"days_elapsed": 999, "last_date": None}
        
    start_date = latest_package.start_date
    if start_date.tzinfo is not None:
        start_date = start_date.replace(tzinfo=None)
        
    delta = datetime.now() - start_date
    return {
        "days_elapsed": delta.days,
        "last_date": latest_package.start_date
    }


@app.post("/api/package/start", response_model=Package, dependencies=[Depends(verify_admin)])
def start_new_package(session: Session = Depends(get_session)):
    new_pkg = Package(
        start_date=datetime.now(),
        post_cost=0.0
    )
    session.add(new_pkg)
    session.commit()
    session.refresh(new_pkg)
    return new_pkg

# ==========================================
# API Routes: Local Explorer Integration
# ==========================================
@app.post("/api/system/open-folder", dependencies=[Depends(verify_admin)])
def open_sheikh_folder(payload: FolderOpenRequest):
    sheikh_dir = os.path.join(SHEIKH_BASE_PATH, payload.sheikh_name)
    if not os.path.exists(sheikh_dir):
        try:
            os.makedirs(sheikh_dir, exist_ok=True)
        except Exception as e:
            raise HTTPException(
                status_code=500, 
                detail=f"Could not create local directory: {e}"
            )
            
    try:
        subprocess.Popen(f'explorer.exe "{sheikh_dir}"')
        return {"status": "opened", "path": sheikh_dir}
    except Exception as e:
        raise HTTPException(
            status_code=500, 
            detail=f"Failed to launch explorer: {e}"
        )



# ==========================================
# API Routes: Gallery Catalog
# ==========================================
@app.get("/api/gallery/{category}")
def list_gallery_images(category: str):
    allowed_categories = ["1_ejaza", "2_background", "3_cover", "4_certificate", "5_tree", "6_stamp"]
    if category not in allowed_categories:
        raise HTTPException(status_code=400, detail="Invalid gallery category.")
        
    gallery_dir = os.path.join(os.path.dirname(__file__), "static", "gallery", category)
    if not os.path.exists(gallery_dir):
        return []
        
    try:
        images = [
            f for f in os.listdir(gallery_dir)
            if os.path.isfile(os.path.join(gallery_dir, f)) and f.lower().endswith(('.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'))
        ]
        return sorted(images)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ==========================================
# API Routes: Sanad Explorer Integration
# ==========================================

class SanadNarratorCreate(BaseModel):
    name: str
    country: str = ""
    city: str = ""
    birth_date: str = ""
    info: str = ""
    notes: str = ""

class SanadNarratorUpdate(BaseModel):
    name: str
    country: str = ""
    city: str = ""
    birth_date: str = ""
    info: str = ""
    notes: str = ""

class SanadEgazaCreate(BaseModel):
    teacher_id: int
    student_id: int
    qeraa: str = ""
    tareq: str = ""

class SanadEgazaUpdate(BaseModel):
    qeraa: str = ""
    tareq: str = ""

def parse_date(date_str: str):
    if not date_str or date_str.strip().lower() in ["n/a", "none", "null", ""]:
        return None
    date_str = date_str.strip()
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d", "%d/%m/%Y", "%m/%d/%Y", "%Y/%m/%d", "%d-%m-%Y"):
        try:
            return datetime.strptime(date_str, fmt)
        except ValueError:
            pass
    if date_str.isdigit() and len(date_str) == 4:
        try:
            return datetime(int(date_str), 1, 1)
        except ValueError:
            pass
    return None

@app.get("/api/sanad/narrators")
def api_sanad_list_narrators(session: Session = Depends(get_session)):
    try:
        statement = select(Qari).order_by(Qari.name_full)
        results = session.exec(statement).all()
        return [
            {
                "id": r.id,
                "name": r.name_full if r.name_full else f"Unnamed (ID: {r.id})",
                "country": r.country if r.country else "",
                "city": r.city if r.city else "",
                "gender": r.gender if r.gender else "Male"
            } for r in results
        ]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database query failed: {e}")

@app.get("/api/sanad/narrators/{id}")
def api_sanad_get_narrator(id: int, session: Session = Depends(get_session)):
    try:
        qari = session.get(Qari, id)
        if not qari:
            raise HTTPException(status_code=404, detail="Narrator not found")
        
        # Clean birth date to string format
        birth_str = ""
        if qari.birth_date:
            birth_str = str(qari.birth_date.date())
            
        return {
            "id": qari.id,
            "name": qari.name_full,
            "info": qari.info if qari.info else "",
            "birth_date": birth_str,
            "country": qari.country if qari.country else "",
            "city": qari.city if qari.city else "",
            "address": qari.address if qari.address else "",
            "phone": qari.phone if qari.phone else "",
            "notes": qari.notes if qari.notes else "",
            "degree": qari.degree if qari.degree is not None else "",
            "gender": qari.gender if qari.gender else "Male"
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database query failed: {e}")

@app.post("/api/sanad/narrators", dependencies=[Depends(verify_sanad_or_admin)])
def api_sanad_create_narrator(payload: SanadNarratorCreate, session: Session = Depends(get_session)):
    try:
        if not payload.name.strip():
            raise HTTPException(status_code=400, detail="Name cannot be empty")
        
        qari = Qari(
            name_full=payload.name.strip(),
            country=payload.country.strip(),
            city=payload.city.strip(),
            birth_date=parse_date(payload.birth_date),
            info=payload.info.strip(),
            notes=payload.notes.strip(),
            gender="Male"
        )
        session.add(qari)
        session.commit()
        session.refresh(qari)
        return {"status": "success", "id": qari.id, "message": "Narrator created successfully"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database query failed: {e}")

@app.put("/api/sanad/narrators/{id}", dependencies=[Depends(verify_sanad_or_admin)])
def api_sanad_update_narrator(id: int, payload: SanadNarratorUpdate, session: Session = Depends(get_session)):
    try:
        qari = session.get(Qari, id)
        if not qari:
            raise HTTPException(status_code=404, detail="Narrator not found")
        
        qari.name_full = payload.name.strip()
        qari.country = payload.country.strip()
        qari.city = payload.city.strip()
        qari.birth_date = parse_date(payload.birth_date)
        qari.info = payload.info.strip()
        qari.notes = payload.notes.strip()
        
        session.add(qari)
        session.commit()
        return {"status": "success", "message": "Narrator details updated successfully"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database query failed: {e}")

@app.delete("/api/sanad/narrators/{id}", dependencies=[Depends(verify_sanad_or_admin)])
def api_sanad_delete_narrator(id: int, session: Session = Depends(get_session)):
    try:
        qari = session.get(Qari, id)
        if not qari:
            raise HTTPException(status_code=404, detail="Narrator not found")
        
        session.delete(qari)
        session.commit()
        return {"status": "success", "message": "Narrator and relations deleted successfully"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database query failed: {e}")

@app.get("/api/sanad/isnad/{id}")
def api_sanad_get_isnad(id: int, session: Session = Depends(get_session)):
    try:
        qari = session.get(Qari, id)
        if not qari:
            raise HTTPException(status_code=404, detail="Narrator not found")
            
        all_qaris = session.exec(select(Qari.id, Qari.name_full)).all()
        qari_cache = {q_id: (name if name else f"Unknown Sheikh (ID: {q_id})") for q_id, name in all_qaris}
        
        all_egazas = session.exec(select(QariEgaza.id, QariEgaza.teacher_id, QariEgaza.student_id, QariEgaza.qeraa, QariEgaza.tareq)).all()
        egaza_cache = {}
        for l_id, t_id, s_id, qe, ta in all_egazas:
            if not t_id or not s_id:
                continue
            if s_id not in egaza_cache:
                egaza_cache[s_id] = []
            egaza_cache[s_id].append((l_id, t_id, qe or "", ta or ""))
            
        visited_globally = set()
        
        def get_qari_name(q_id: int) -> str:
            return qari_cache.get(q_id, f"Unknown Sheikh (ID: {q_id})")

        def traverse(q_id: int, visited_set: set, depth: int = 0) -> dict:
            q_name = get_qari_name(q_id)
            if depth >= 3:
                return {"id": q_id, "name": q_name, "teachers": []}
                
            node = {"id": q_id, "name": q_name, "teachers": []}
            if q_id in visited_set:
                node["teachers"].append({
                    "id": -1,
                    "name": "[CYCLE DETECTED - LOOP DETECTED]",
                    "qeraa": "",
                    "tareq": "",
                    "teachers": []
                })
                return node
                
            if q_id in visited_globally:
                node["name"] += " (مكرر - تم عرضه في مسار آخر)"
                node["collapsed"] = True
                return node
                
            visited_globally.add(q_id)
            new_visited = visited_set | {q_id}
            
            records = egaza_cache.get(q_id, [])
            for link_id, teacher_id, qeraa, tareq in records:
                teacher_tree = traverse(teacher_id, new_visited, depth + 1)
                teacher_tree["link_id"] = link_id
                teacher_tree["qeraa"] = qeraa
                teacher_tree["tareq"] = tareq
                node["teachers"].append(teacher_tree)
                
            return node

        tree = traverse(id, set(), 0)
        return tree
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database tree query failed: {e}")

@app.get("/api/sanad/narrators/{id}/students")
def api_sanad_get_students(id: int, session: Session = Depends(get_session)):
    try:
        statement = (
            select(QariEgaza.id, Qari.id, Qari.name_full, Qari.country, Qari.city, QariEgaza.qeraa, QariEgaza.tareq)
            .join(Qari, QariEgaza.student_id == Qari.id)
            .where(QariEgaza.teacher_id == id)
            .order_by(Qari.name_full)
        )
        results = session.execute(statement).fetchall()
        
        students = []
        for link_id, s_id, s_name, country, city, qeraa, tareq in results:
            students.append({
                "id": s_id,
                "name": s_name if s_name else f"Unnamed (ID: {s_id})",
                "country": country if country else "",
                "city": city if city else "",
                "qeraa": qeraa if qeraa else "",
                "tareq": tareq if tareq else ""
            })
        return students
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database query failed: {e}")

@app.post("/api/sanad/egazas", dependencies=[Depends(verify_sanad_or_admin)])
def api_sanad_create_egaza(payload: SanadEgazaCreate, session: Session = Depends(get_session)):
    try:
        if payload.teacher_id == payload.student_id:
            raise HTTPException(status_code=400, detail="A Sheikh cannot give an Egaza to themselves")

        teacher = session.get(Qari, payload.teacher_id)
        student = session.get(Qari, payload.student_id)
        if not teacher or not student:
            raise HTTPException(status_code=400, detail="Teacher or Student ID not found")
            
        statement = select(func.count(QariEgaza.id)).where(
            and_(
                QariEgaza.teacher_id == payload.teacher_id,
                QariEgaza.student_id == payload.student_id,
                QariEgaza.qeraa == payload.qeraa.strip(),
                QariEgaza.tareq == payload.tareq.strip()
            )
        )
        exists = session.exec(statement).one() > 0
        if exists:
            raise HTTPException(status_code=400, detail="This Egaza relationship already exists")
            
        new_egaza = QariEgaza(
            teacher_id=payload.teacher_id,
            student_id=payload.student_id,
            qeraa=payload.qeraa.strip(),
            tareq=payload.tareq.strip()
        )
        session.add(new_egaza)
        session.commit()
        session.refresh(new_egaza)
        return {"status": "success", "id": new_egaza.id, "message": "Egaza relationship created successfully"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database query failed: {e}")

@app.put("/api/sanad/egazas/{link_id}", dependencies=[Depends(verify_sanad_or_admin)])
def api_sanad_update_egaza(link_id: int, payload: SanadEgazaUpdate, session: Session = Depends(get_session)):
    try:
        egaza = session.get(QariEgaza, link_id)
        if not egaza:
            raise HTTPException(status_code=404, detail="Egaza relationship not found")
            
        egaza.qeraa = payload.qeraa.strip()
        egaza.tareq = payload.tareq.strip()
        session.add(egaza)
        session.commit()
        return {"status": "success", "message": "Egaza relationship updated successfully"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database query failed: {e}")

@app.delete("/api/sanad/egazas/{link_id}", dependencies=[Depends(verify_sanad_or_admin)])
def api_sanad_delete_egaza(link_id: int, session: Session = Depends(get_session)):
    try:
        egaza = session.get(QariEgaza, link_id)
        if not egaza:
            raise HTTPException(status_code=404, detail="Egaza relationship not found")
            
        session.delete(egaza)
        session.commit()
        return {"status": "success", "message": "Egaza relationship deleted successfully"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database query failed: {e}")


# ==========================================
# Serves Static Frontend
# ==========================================
@app.get("/")
def read_root():
    static_index = os.path.join(os.path.dirname(__file__), "static", "index.html")
    if os.path.exists(static_index):
        return FileResponse(static_index)
    return {"message": "OTOR Backend API is running."}

app.mount("/static", StaticFiles(directory=os.path.join(os.path.dirname(__file__), "static")), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
