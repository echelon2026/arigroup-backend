from sqlalchemy import Column, Integer, String, DateTime, Boolean, Float, ForeignKey, Text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship
from datetime import datetime
import uuid

Base = declarative_base()

class Restaurant(Base):
    __tablename__ = "restaurants"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String, nullable=False)
    email = Column(String, unique=True, nullable=False)
    phone = Column(String)
    address = Column(String)
    city = Column(String)
    created_at = Column(DateTime, default=datetime.utcnow)
    subscription_active = Column(Boolean, default=True)
    subscription_end = Column(DateTime)

    models = relationship("ARModel", back_populates="restaurant", cascade="all, delete-orphan")
    qr_codes = relationship("QRCode", back_populates="restaurant", cascade="all, delete-orphan")

class ARModel(Base):
    __tablename__ = "ar_models"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    restaurant_id = Column(String, ForeignKey("restaurants.id"), nullable=False)
    name = Column(String, nullable=False)
    description = Column(Text)
    file_path = Column(String, nullable=False)
    file_type = Column(String)  # obj, gltf, glb
    file_size = Column(Integer)
    scale = Column(Float, default=1.0)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    restaurant = relationship("Restaurant", back_populates="models")
    qr_codes = relationship("QRCode", back_populates="model", cascade="all, delete-orphan")

class QRCode(Base):
    __tablename__ = "qr_codes"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    restaurant_id = Column(String, ForeignKey("restaurants.id"), nullable=False)
    model_id = Column(String, ForeignKey("ar_models.id"), nullable=False)
    code_url = Column(String, nullable=False)  # URL to viewer
    qr_image_path = Column(String)  # Path to QR image
    created_at = Column(DateTime, default=datetime.utcnow)
    scans = Column(Integer, default=0)

    restaurant = relationship("Restaurant", back_populates="qr_codes")
    model = relationship("ARModel", back_populates="qr_codes")
