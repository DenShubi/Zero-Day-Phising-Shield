from typing import Optional
from pydantic import AliasChoices, BaseModel, Field


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
        default_factory=list, description="Human-readable forensic indicators explaining the risk score"
    )


class Phase1ScanRequest(BaseModel):
    url: str = Field(
        ...,
        validation_alias=AliasChoices("url", "target_url"),
        description="Target URL to inspect inside the headless sandbox",
    )
    scan_id: Optional[str] = Field(default=None, description="Optional custom scan identifier")
    reporter_source: str = Field(
        default="WEB_SANDBOX",
        description="Incident source channel: WEB_SANDBOX, WHATSAPP_BOT, or BROWSER_EXT",
    )
    reporter_unit: str = Field(
        default="Simulasi Juri / Satuan Jajaran",
        description="Reporting unit or operator label for SOC logging",
    )


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


class DetectedLogo(BaseModel):
    brand_name: str = Field(..., description="Detected official military brand/emblem name")
    confidence: float = Field(..., ge=0.0, le=100.0, description="Detection confidence percentage (0-100)")
    bbox: BoundingBox = Field(..., description="Viewport bounding box of the detected logo")


class DecodedQRCode(BaseModel):
    payload: str = Field(..., description="Decoded QR text or URL payload")
    bbox: BoundingBox = Field(..., description="Bounding box of the QR code inside the image")


class ImageScanRequest(BaseModel):
    image_url: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("image_url", "url", "attachment"),
        description="Remote or local URL/path of the screenshot or poster image to analyze",
    )
    image_base64: Optional[str] = Field(
        default=None,
        description="Optional base64-encoded PNG/JPG image payload",
    )
    caption: Optional[str] = Field(
        default=None,
        description="Optional message text or caption accompanying the image",
    )
    scan_id: Optional[str] = Field(default=None, description="Optional custom scan identifier")
    reporter_source: str = Field(
        default="WEB_SANDBOX",
        description="Incident source channel: WEB_SANDBOX, WHATSAPP_BOT, or BROWSER_EXT",
    )
    reporter_unit: str = Field(
        default="Simulasi Juri / Satuan Jajaran",
        description="Reporting unit or operator label for SOC logging",
    )


class ImageScanResponse(BaseModel):
    success: bool
    scan_id: str
    source_image: str
    verdict: str = Field(..., description="Final threat verdict: SAFE, SUSPICIOUS, or CRITICAL_PHISHING")
    total_risk_score: float = Field(..., ge=0.0, le=100.0)
    visual_similarity_score: float = Field(..., ge=0.0, le=100.0)
    dom_anomaly_score: float = Field(..., ge=0.0, le=100.0)
    domain_telemetry_score: float = Field(..., ge=0.0, le=100.0)
    impersonated_target: Optional[str] = None
    detected_logos: list[DetectedLogo] = Field(default_factory=list)
    decoded_qr_codes: list[DecodedQRCode] = Field(default_factory=list)
    extracted_urls: list[str] = Field(default_factory=list)
    forensic_reasons: list[str] = Field(default_factory=list)
    screenshot_path: str
    annotated_dom_path: str
    captured_screenshot_url: Optional[str] = None
    annotated_bbox_url: Optional[str] = None
    supabase_synced: bool = False
    supabase_incident_id: Optional[str] = None
    execution_time_sec: float


class Phase2ScanResponse(Phase1ScanResponse):
    verdict: str = Field(..., description="Final threat verdict: SAFE, SUSPICIOUS, or CRITICAL_PHISHING")
    total_risk_score: float = Field(..., ge=0.0, le=100.0, description="Weighted composite risk score (0-100)")
    visual_similarity_score: float = Field(..., ge=0.0, le=100.0, description="SSIM + visual similarity score (0-100)")
    impersonated_target: Optional[str] = Field(default=None, description="Matched official portal name if impersonated")
    detected_logos: list[DetectedLogo] = Field(default_factory=list, description="Detected official logos with bounding boxes")
    captured_screenshot_url: Optional[str] = Field(
        default=None, description="Public URL (Supabase Storage or local static) of raw viewport screenshot"
    )
    annotated_bbox_url: Optional[str] = Field(
        default=None, description="Public URL (Supabase Storage or local static) of annotated bounding-box image"
    )
    supabase_synced: bool = Field(
        default=False, description="True if scan incident was persisted to Supabase scan_incidents"
    )
    supabase_incident_id: Optional[str] = Field(
        default=None, description="UUID of inserted row in Supabase scan_incidents"
    )
