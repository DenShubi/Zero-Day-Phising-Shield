from typing import Optional
from pydantic import BaseModel, Field


class BoundingBox(BaseModel):
    x: int = Field(..., description="Top-left X coordinate in viewport pixels")
    y: int = Field(..., description="Top-left Y coordinate in viewport pixels")
    width: int = Field(..., description="Element width in viewport pixels")
    height: int = Field(..., description="Element height in viewport pixels")


class FormElement(BaseModel):
    form_index: int = Field(..., description="Zero-based index of the form in the DOM")
    action: str = Field(..., description="Raw action attribute value on the <form> tag")
    resolved_action: str = Field(..., description="Fully resolved target URL for form submission")
    method: str = Field(..., description="HTTP submission method (GET/POST)")
    is_cross_origin: bool = Field(..., description="True if form submits to a different origin than the page")
    bbox: BoundingBox = Field(..., description="Viewport bounding box of the form element")


class InputElement(BaseModel):
    tag: str = Field(..., description="HTML tag name (input, select, textarea)")
    type: str = Field(..., description="Input type attribute (text, password, email, etc.)")
    name: str = Field(..., description="Input name attribute")
    id: str = Field(..., description="Input id attribute")
    placeholder: str = Field(..., description="Input placeholder text")
    required: bool = Field(..., description="Whether the input has the required attribute")
    is_sensitive_credential: bool = Field(
        ...,
        description="True if input collects passwords, NRP, NIK, PIN, OTP, or user credentials",
    )
    bbox: BoundingBox = Field(..., description="Viewport bounding box of the input element")


class ImageElement(BaseModel):
    src: str = Field(..., description="Resolved image source URL or data URI")
    alt: str = Field(..., description="Image alt text")
    bbox: BoundingBox = Field(..., description="Viewport bounding box of the image element")


class DomRiskAnalysis(BaseModel):
    dom_anomaly_score: float = Field(
        ..., ge=0.0, le=100.0, description="Heuristic DOM risk score (0-100)"
    )
    domain_telemetry_score: float = Field(
        ..., ge=0.0, le=100.0, description="Domain and URL telemetry risk score (0-100)"
    )
    has_credential_harvesting: bool = Field(
        ..., description="True if sensitive credential inputs are detected on an unauthorized page"
    )
    is_official_mil_domain: bool = Field(
        ..., description="True if hostname matches official TNI AD / Kemhan whitelist"
    )
    forensic_reasons: list[str] = Field(
        default_factory=list, description="Human-readable forensic indicators Explaining the risk score"
    )


class Phase1ScanRequest(BaseModel):
    url: str = Field(..., description="Target URL to inspect inside the headless sandbox")
    scan_id: Optional[str] = Field(default=None, description="Optional custom scan identifier")


class Phase1ScanResponse(BaseModel):
    success: bool
    scan_id: str
    initial_url: str
    final_url: str
    redirect_chain: list[str]
    status_code: int
    screenshot_path: str
    annotated_dom_path: str
    page_title: str
    forms: list[FormElement]
    inputs: list[InputElement]
    images: list[ImageElement]
    detected_military_keywords: list[str]
    external_domains_contacted: list[str]
    risk_analysis: DomRiskAnalysis
    execution_time_sec: float

