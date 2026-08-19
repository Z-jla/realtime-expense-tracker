package com.spendapp.mobile;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(PaddleOcrPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
