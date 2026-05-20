import os
import subprocess
from datetime import datetime
from typing import List, Optional
from fastapi import FastAPI, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import Session, select, func, text, and_
from pydantic import BaseModel

# Import local configuration and models
from database import get_session, engine
from models import Sheikh, Orders, Content, Expenses, Money, Package, OrderHistory

app = FastAPI(
    title="OTOR Manager API",
    description="Backend API for OTOR AlQuran Quran Portal, driving data from Neon PostgreSQL.",
    version="1.0"
)

# Enable CORS for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Base path for local system sheikh folders
SHEIKH_BASE_PATH = r"G:\sheikh"

# Pydantic schemas for custom payloads
class BulkContentInput(BaseModel):
    order_id: int
    raw_text: str  # Format: STUDENT_NAME - STUDENT_GENDER - STUDENT_INFO - QERAA

class OrderStateUpdate(BaseModel):
    state: str

class FolderOpenRequest(BaseModel):
    sheikh_name: str

# Helper to generate the next integer primary key for non-serial tables
def get_next_id(session: Session, table_name: str) -> int:
    statement = text(f"SELECT COALESCE(MAX(id), 0) + 1 FROM {table_name}")
    return session.execute(statement).scalar()

# ==========================================
# API Routes: Sheikhs
# ==========================================
@app.get("/api/sheikhs", response_model=List[Sheikh])
def list_sheikhs(
    search: Optional[str] = None,
    session: Session = Depends(get_session)
):
    query = select(Sheikh)
    if search:
        query = query.where(Sheikh.name.ilike(f"%{search}%"))
    query = query.order_by(Sheikh.name)
    return session.exec(query).all()

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
        text("SELECT SUM(cost) FROM order_history WHERE sheikh_name = :name"),
        {"name": sheikh.name}
    ).scalar() or 0.0
    
    # 2. Total items count (from CONTENT where order_id in order_history)
    items_count = session.execute(
        text("""
            SELECT COUNT(*) FROM content 
            WHERE order_id IN (
                SELECT id FROM order_history WHERE sheikh_name = :name
            )
        """),
        {"name": sheikh.name}
    ).scalar() or 0
    
    # 3. Active orders count
    active_count = session.execute(
        text("SELECT COUNT(*) FROM orders WHERE sheikh_id = :id"),
        {"id": id}
    ).scalar() or 0

    return {
        "sheikh_id": id,
        "name": sheikh.name,
        "total_historical_cost": history_cost,
        "total_historical_items": items_count,
        "active_orders_count": active_count
    }

@app.post("/api/sheikhs", response_model=Sheikh)
def create_sheikh(sheikh: Sheikh, session: Session = Depends(get_session)):
    # Manual ID assignment
    sheikh.id = get_next_id(session, "sheikh")
    sheikh.insert_date = datetime.now()
    session.add(sheikh)
    session.commit()
    session.refresh(sheikh)
    return sheikh

@app.put("/api/sheikhs/{id}", response_model=Sheikh)
def update_sheikh(id: int, updated_sheikh: Sheikh, session: Session = Depends(get_session)):
    sheikh = session.get(Sheikh, id)
    if not sheikh:
        raise HTTPException(status_code=404, detail="Sheikh not found")
    
    # Track name changes to update active orders sheikh_name cache
    name_changed = (sheikh.name != updated_sheikh.name)
    old_name = sheikh.name

    # Update sheikh details
    for key, value in updated_sheikh.model_dump(exclude={"id", "insert_date"}).items():
        setattr(sheikh, key, value)
        
    session.add(sheikh)
    
    # Cascade update active order sheikh names if changed
    if name_changed:
        session.execute(
            text("UPDATE orders SET sheikh_name = :new_name WHERE sheikh_id = :id"),
            {"new_name": sheikh.name, "id": id}
        )
        
    session.commit()
    session.refresh(sheikh)
    return sheikh

@app.delete("/api/sheikhs/{id}")
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
    session: Session = Depends(get_session)
):
    query = select(Orders)
    if state != "ALL":
        query = query.where(Orders.state == state)
    
    # Sorted by degree, rest desc, insert_date as in Form_Load
    query = query.order_by(Orders.degree, Orders.rest.desc(), Orders.insert_date)
    orders_list = session.exec(query).all()
    
    # Join with sheikh phone/city for ease in frontend dashboard
    orders_with_sheikh = []
    for order in orders_list:
        sheikh = session.get(Sheikh, order.sheikh_id) if order.sheikh_id else None
        order_dict = order.model_dump()
        order_dict["sheikh_phone"] = sheikh.phone if sheikh else ""
        order_dict["sheikh_city"] = sheikh.city if sheikh else ""
        orders_with_sheikh.append(order_dict)
        
    return orders_with_sheikh

@app.get("/api/orders/{id}")
def get_order_details(id: int, session: Session = Depends(get_session)):
    order = session.get(Orders, id)
    if not order:
        # Fallback to history to see if it was archived
        hist = session.get(OrderHistory, id)
        if hist:
            return {"archived": True, "order": hist.model_dump(), "sheikh": None}
        raise HTTPException(status_code=404, detail="Order not found")
    
    sheikh = session.get(Sheikh, order.sheikh_id) if order.sheikh_id else None
    return {
        "archived": False,
        "order": order,
        "sheikh": sheikh
    }

@app.post("/api/orders", response_model=Orders)
def create_order(order: Orders, session: Session = Depends(get_session)):
    order.id = get_next_id(session, "orders")
    order.insert_date = datetime.now()
    order.update_date = datetime.now()
    
    # Auto calculation
    order.rest = (order.cost or 0.0) - (order.paid or 0.0)
    
    # Fetch sheikh name automatically if sheikh_id is present but sheikh_name is empty
    if order.sheikh_id and not order.sheikh_name:
        sheikh = session.get(Sheikh, order.sheikh_id)
        if sheikh:
            order.sheikh_name = sheikh.name
            # Copy receiver defaults from sheikh if empty
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
    
    # Auto insert a default content row: INSERT INTO CONTENT (TYPE, ORDER_ID) VALUES ('OTHER', order_id)
    # as in Form_AfterInsert of Access VBA
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
    
    session.refresh(order)
    return order

@app.put("/api/orders/{id}", response_model=Orders)
def update_order(id: int, updated_order: Orders, session: Session = Depends(get_session)):
    order = session.get(Orders, id)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    
    # Update fields
    for key, value in updated_order.model_dump(exclude={"id", "insert_date"}).items():
        setattr(order, key, value)
        
    order.update_date = datetime.now()
    order.rest = (order.cost or 0.0) - (order.paid or 0.0)
    
    # If sheikh changed, update sheikh name cache
    if order.sheikh_id:
        sheikh = session.get(Sheikh, order.sheikh_id)
        if sheikh:
            order.sheikh_name = sheikh.name
            
    session.add(order)
    session.commit()
    session.refresh(order)
    return order

@app.put("/api/orders/{id}/state")
def update_order_state(id: int, payload: OrderStateUpdate, session: Session = Depends(get_session)):
    order = session.get(Orders, id)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    
    new_state = payload.state.upper()
    order.update_date = datetime.now()
    
    # VBA logic: If state changes to DONE and rest > 0, set to DELIVER instead
    if new_state == "DONE":
        if (order.rest or 0.0) > 0.0:
            order.state = "DELIVER"
            session.add(order)
            session.commit()
            session.refresh(order)
            return {"status": "state_coerced_to_deliver", "order": order}
        else:
            # Fully paid and DONE -> Archive to ORDER_HISTORY and delete from ORDERS
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

@app.delete("/api/orders/{id}")
def delete_order(id: int, session: Session = Depends(get_session)):
    order = session.get(Orders, id)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
        
    # VBA Command32_Click deletes CONTENT rows first: DELETE FROM CONTENT WHERE ORDER_ID = id
    session.execute(
        text("DELETE FROM content WHERE order_id = :order_id"),
        {"order_id": id}
    )
    
    # Delete the active order
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

@app.post("/api/content", response_model=Content)
def create_content(content: Content, session: Session = Depends(get_session)):
    content.id = get_next_id(session, "content")
    session.add(content)
    session.commit()
    session.refresh(content)
    return content

@app.put("/api/content/{id}", response_model=Content)
def update_content(id: int, updated_content: Content, session: Session = Depends(get_session)):
    content = session.get(Content, id)
    if not content:
        raise HTTPException(status_code=404, detail="Content item not found")
        
    for key, value in updated_content.model_dump(exclude={"id"}).items():
        setattr(content, key, value)
        
    session.add(content)
    session.commit()
    session.refresh(content)
    return content

@app.delete("/api/content/{id}")
def delete_content(id: int, session: Session = Depends(get_session)):
    content = session.get(Content, id)
    if not content:
        raise HTTPException(status_code=404, detail="Content item not found")
    session.delete(content)
    session.commit()
    return {"detail": "Content item deleted successfully"}

# Bulk insertion of students parsing (Command55_Click)
@app.post("/api/content/bulk")
def bulk_insert_content(payload: BulkContentInput, session: Session = Depends(get_session)):
    # Verify order exists
    order = session.get(Orders, payload.order_id)
    if not order:
        # Check order history
        hist = session.get(OrderHistory, payload.order_id)
        if not hist:
            raise HTTPException(status_code=404, detail="Order not found")
            
    lines = payload.raw_text.strip().split("\n")
    inserted_count = 0
    
    for line in lines:
        if not line.strip():
            continue
            
        parts = [p.strip() for p in line.split("-")]
        
        # Format expects: STUDENT_NAME - STUDENT_GENDER - STUDENT_INFO - QERAA
        # Fallbacks if some values are missing
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
    return {"inserted_count": inserted_count}

# ==========================================
# API Routes: Expenses & Money
# ==========================================
@app.get("/api/expenses", response_model=List[Expenses])
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
    # Group by category and sum amount
    results = session.execute(
        text("SELECT category, SUM(amount) as total FROM expenses GROUP BY category ORDER BY total DESC")
    ).fetchall()
    return [{"category": r[0], "total": float(r[1])} for r in results]

@app.post("/api/expenses", response_model=Expenses)
def create_expense(expense: Expenses, session: Session = Depends(get_session)):
    expense.due_date = expense.due_date or datetime.now()
    session.add(expense)
    session.commit()
    session.refresh(expense)
    return expense

# ==========================================
# API Routes: Package Status (Analogous to check_package)
# ==========================================
@app.get("/api/package/status")
def get_package_status(session: Session = Depends(get_session)):
    # Get the latest package start date
    latest_package = session.exec(
        select(Package).order_by(Package.start_date.desc())
    ).first()
    
    if not latest_package:
        return {"days_elapsed": 999, "last_date": None}
        
    delta = datetime.now() - latest_package.start_date
    return {
        "days_elapsed": delta.days,
        "last_date": latest_package.start_date
    }

@app.post("/api/package/start", response_model=Package)
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
# API Routes: Local Explorer Integration (Command21_Click)
# ==========================================
@app.post("/api/system/open-folder")
def open_sheikh_folder(payload: FolderOpenRequest):
    sheikh_dir = os.path.join(SHEIKH_BASE_PATH, payload.sheikh_name)
    
    # Verify folder path exists, if not, create it
    if not os.path.exists(sheikh_dir):
        try:
            os.makedirs(sheikh_dir, exist_ok=True)
        except Exception as e:
            raise HTTPException(
                status_code=500, 
                detail=f"Could not create local directory: {e}"
            )
            
    # Trigger Windows explorer
    try:
        subprocess.Popen(f'explorer.exe "{sheikh_dir}"')
        return {"status": "opened", "path": sheikh_dir}
    except Exception as e:
        raise HTTPException(
            status_code=500, 
            detail=f"Failed to launch explorer: {e}"
        )

# ==========================================
# Serves Static Frontend
# ==========================================
# Route to main landing file
@app.get("/")
def read_root():
    static_index = os.path.join(os.path.dirname(__file__), "static", "index.html")
    if os.path.exists(static_index):
        return FileResponse(static_index)
    return {"message": "OTOR Backend API is running. Please create static assets."}

# Mount static folder
app.mount("/static", StaticFiles(directory=os.path.join(os.path.dirname(__file__), "static")), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
