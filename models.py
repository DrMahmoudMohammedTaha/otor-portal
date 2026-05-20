from datetime import datetime
from typing import Optional
from sqlmodel import SQLModel, Field
from decimal import Decimal

# ==========================================
# 1. SHEIKH
# ==========================================
class Sheikh(SQLModel, table=True):
    __tablename__ = "sheikh"
    
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    info: Optional[str] = None
    comment: Optional[str] = None
    gender: Optional[bool] = True  # True = معلم, False = معلمة
    receiver_name: Optional[str] = None
    phone: Optional[str] = None
    country: Optional[str] = None
    city: Optional[str] = None
    address: Optional[str] = None
    insert_date: Optional[datetime] = Field(default_factory=datetime.now)

# ==========================================
# 2. ORDERS
# ==========================================
class Orders(SQLModel, table=True):
    __tablename__ = "orders"
    
    id: Optional[int] = Field(default=None, primary_key=True)
    state: Optional[str] = "NEXT"  # NEXT, DESIGN, PRINT, POST, DELIVER
    sheikh_id: Optional[int] = Field(default=None, foreign_key="sheikh.id")
    sheikh_name: Optional[str] = None
    comment: Optional[str] = None
    contents: Optional[str] = None
    cost: Optional[float] = 0.0
    paid: Optional[float] = 0.0
    rest: Optional[float] = 0.0  # cost - paid
    p_receiver: Optional[str] = None
    p_phone: Optional[str] = None
    p_country: Optional[str] = None
    p_city: Optional[str] = None
    p_address: Optional[str] = None
    insert_date: Optional[datetime] = Field(default_factory=datetime.now)
    update_date: Optional[datetime] = Field(default_factory=datetime.now)
    degree: Optional[float] = 0.0

# ==========================================
# 3. CONTENT
# ==========================================
class Content(SQLModel, table=True):
    __tablename__ = "content"
    
    id: Optional[int] = Field(default=None, primary_key=True)
    order_id: Optional[int] = None  # No database constraint (can be orders.id or order_history.id)
    type: Optional[str] = "EJAZA"   # EJAZA, OTHER, etc.
    amount: Optional[float] = 1.0
    cost: Optional[float] = 0.0
    comment: Optional[str] = None
    student_name: Optional[str] = None
    student_gender: Optional[str] = None
    student_info: Optional[str] = None
    qeraa: Optional[str] = None
    tareq: Optional[str] = None
    state: Optional[str] = None
    degree: Optional[float] = 0.0
    review: Optional[str] = None

# ==========================================
# 4. EXPENSES
# ==========================================
class Expenses(SQLModel, table=True):
    __tablename__ = "expenses"
    
    id: Optional[int] = Field(default=None, primary_key=True)
    expense: str
    amount: float = 0.0
    category: str
    comment: Optional[str] = None
    due_date: Optional[datetime] = Field(default_factory=datetime.now)

# ==========================================
# 5. MONEY
# ==========================================
class Money(SQLModel, table=True):
    __tablename__ = "money"
    
    id: Optional[int] = Field(default=None, primary_key=True)
    expense: str
    amount: float = 0.0
    comment: Optional[str] = None
    due_date: Optional[datetime] = Field(default_factory=datetime.now)

# ==========================================
# 6. PACKAGE
# ==========================================
class Package(SQLModel, table=True):
    __tablename__ = "package"
    
    id: Optional[int] = Field(default=None, primary_key=True)
    start_date: Optional[datetime] = Field(default_factory=datetime.now)
    end_date: Optional[datetime] = None
    post_cost: Optional[float] = 0.0

# ==========================================
# 7. ORDER HISTORY
# ==========================================
class OrderHistory(SQLModel, table=True):
    __tablename__ = "order_history"
    
    id: Optional[int] = Field(default=None, primary_key=True)
    state: Optional[str] = "DONE"
    sheikh_id: Optional[int] = None
    sheikh_name: Optional[str] = None
    comment: Optional[str] = None
    contents: Optional[str] = None
    cost: Optional[float] = 0.0
    paid: Optional[float] = 0.0
    rest: Optional[float] = 0.0
    p_receiver: Optional[str] = None
    p_phone: Optional[str] = None
    p_country: Optional[str] = None
    p_city: Optional[str] = None
    p_address: Optional[str] = None
    insert_date: Optional[datetime] = None
    update_date: Optional[datetime] = Field(default_factory=datetime.now)
    degree: Optional[float] = 0.0
