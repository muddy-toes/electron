let targetLevelL = 50;
let targetLevelR = 30;
let currentLevelL = 0;
let currentLevelR = 0;

function drawVuGauges() {
    background(40, 35, 30);
    angleMode(RADIANS);

    let leftMax = 0;
    let rightMax = 0;

    if (leftOsc.started) {
        const amplL = wavLa.waveform();
        const amplL2 = wavLa2.waveform();
        // NOTE: Need to pass a string to wavLf.waveform() otherwise clips to [-1,1]
        const freqL = wavLf.waveform('float');
        // NOTE: Total amplitude (volume + AM depth) can be greater than 1,
        // resulting in clipping and distortion of the tone.
        // However, we clamp the VU Meter to a maximum of 1.
        leftMax = Math.abs(leftOsc.getAmp() + amplL[0] + amplL2[0]);
    }

    if (rightOsc.started) {
        const amplR = wavRa.waveform();
        const amplR2 = wavRa2.waveform();
        const freqR = wavRf.waveform('float');
        rightMax = Math.abs(rightOsc.getAmp() + amplR[0] + amplR2[0]);
    }

    targetLevelL = map(leftMax, 0, 1, 0, 100);
    targetLevelR = map(rightMax, 0, 1, 0, 100);
    
    targetLevelL = constrain(targetLevelL, 0, 100);
    targetLevelR = constrain(targetLevelR, 0, 100);
    
    // Smooth the needle movement
    currentLevelL = lerp(currentLevelL, targetLevelL, 0.1);
    currentLevelR = lerp(currentLevelR, targetLevelR, 0.1);
    
    // Draw left channel meter
    push();
    translate(0, 0);
    drawMeter(currentLevelL, "L");
    pop();
    
    // Draw right channel meter
    push();
    translate(410, 0);
    drawMeter(currentLevelR, "R");
    pop();
}

function drawMeter(level, channel) {
    // Draw the meter housing
    drawMeterHousing();
    
    // Draw the scale
    drawScale();
    
    // Draw the needle
    drawNeedle(level);
    
    // Draw labels
    drawLabels(channel);
    
    // Draw LED indicators
    drawLEDs(level);
}

function drawMeterHousing() {
    // Outer bezel
    fill(60, 55, 50);
    stroke(80, 75, 70);
    strokeWeight(3);
    rect(100, 0, 300, 200, 15);
    
    // Inner housing
    fill(25, 20, 15);
    stroke(15, 10, 5);
    strokeWeight(2);
    rect(120, 20, 260, 160, 10);
    
    // Meter face (half circle - top half, larger to fill the box)
    fill(245, 240, 230);
    stroke(200, 195, 185);
    strokeWeight(1);
    arc(250, 150, 220, 220, PI, TWO_PI);
    
    // Center hub
    fill(40, 35, 30);
    stroke(60, 55, 50);
    strokeWeight(2);
    ellipse(250, 150, 12, 12);
}

function drawScale() {
    push();
    translate(250, 150);
    
    // Scale marks only (no numbers)
    let numTicks = 15; // More tick marks for finer resolution
    
    for (let i = 0; i <= numTicks; i++) {
        let angle = map(i, 0, numTicks, PI, 0); // Half circle from left to right (top half)
        let x1 = cos(angle) * 90;
        let y1 = -sin(angle) * 90; // NEGATIVE for top half
        let x2 = cos(angle) * 105;
        let y2 = -sin(angle) * 105; // NEGATIVE for top half
        
        // Color coding - last few marks in red zone
        if (i > numTicks * 0.8) {
            stroke(200, 50, 50); // Red zone
        } else {
            stroke(50, 45, 40);
        }
        
        // Major tick marks every 3rd mark
        if (i % 3 == 0) {
            strokeWeight(2);
        } else {
            strokeWeight(1);
        }
        
        line(x1, y1, x2, y2);
    }
    
    pop();
}

function drawNeedle(level) {
    push();
    translate(250, 150);
    
    // Convert level (0-100) to angle: 0% = PI (straight left), 100% = 0 (straight right)
    // But we need to reverse the direction so it goes upward (counter-clockwise)
    let clampedLevel = constrain(level, 0, 100);
    let angle = map(clampedLevel, 0, 100, PI, 0);
    rotate(-angle); // NEGATIVE rotation for counter-clockwise movement
    
    // Needle shadow
    push();
    translate(1, 1);
    stroke(0, 0, 0, 100);
    strokeWeight(3);
    line(0, 0, 85, 0); // Horizontal line pointing in the rotation direction
    pop();
    
    // Main needle
    stroke(200, 50, 50);
    strokeWeight(2);
    line(0, 0, 85, 0); // Horizontal line pointing in the rotation direction
    
    // Needle tip
    fill(200, 50, 50);
    noStroke();
    ellipse(85, 0, 3, 3);
    
    // Balance weight
    stroke(100, 95, 90);
    strokeWeight(4);
    line(0, 0, -8, 0); // Short line pointing backward
    
    pop();
}

function drawLabels(channel) {
    // VU label
    fill(50, 45, 40);
    textAlign(CENTER, CENTER);
    
    // Channel label
    textSize(16);
    textStyle(BOLD);
    text(channel, 250, 90);
}

function drawLEDs(level) {
    // Peak LEDs
    let ledY = 170;
    let ledSpacing = 25;
    let startX = 200;
    
    for (let i = 0; i < 5; i++) {
        let ledX = startX + i * ledSpacing;
        let threshold = 60 + i * 8;
        
        if (level > threshold) {
            if (i < 3) {
                fill(50, 200, 50); // Green
            } else if (i < 4) {
                fill(200, 200, 50); // Yellow
            } else {
                fill(200, 50, 50); // Red
            }
        } else {
            fill(30, 25, 20);
        }
        
        noStroke();
        ellipse(ledX, ledY, 8, 8);
        
        // LED housing
        stroke(60, 55, 50);
        strokeWeight(1);
        noFill();
        ellipse(ledX, ledY, 10, 10);
    }
}

