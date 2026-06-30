// clients.js

const CLIENTS = {

    "ALGAR": {
        "client_id":     "b12902ec-f59e-4405-b3f4-fbb935dd6c05",
        "client_secret": "2a9fbf54-4bc7-4aee-88b3-5019d883eef1",
        "grant_type":    "client_credentials",
        "scope":         "fttx"
    },

    "AMIGONET_TRG": {
        "client_id":     "d0b10c26-c1e4-4740-83de-41544fee82f8",
        "client_secret": "06a877b7-1d0e-4b9c-a8e6-23744a590a97",
        "grant_type":    "client_credentials",
        "scope":         "fttx"
    },

    // ✅ CC9999 com credenciais específicas por ambiente
    "CC9999": {
        "client_id":     "deb8f67a-1b19-4f97-9f71-83b125d729fc",
        "client_secret": "768bcd8d-ea07-450e-a034-ddb29c12ef7d",
        "grant_type":    "client_credentials",
        "scope":         "fttx",
        "credentials_by_env": {
            "TRG": {
                "client_id":     "deb8f67a-1b19-4f97-9f71-83b125d729fc",
                "client_secret": "768bcd8d-ea07-450e-a034-ddb29c12ef7d"
            },
            "TI": {
                "client_id":     "deb8f67a-1b19-4f97-9f71-83b125d729fc",
                "client_secret": "768bcd8d-ea07-450e-a034-ddb29c12ef7d"
            },
            "TRG2": {
                "client_id":     "pJ1cLnwCRq3jTq4DdTpKqGAdXARyFjNnRiOeadJjlkougL4S",
                "client_secret": "ZzQi6bdZOZRTFwRCpMfh0JZS5GdvvCQZm3CAmreKsa3KBFMimi6Yu04Euj1Te5F5"
            }
        }
    },

    "CLARO_FTTP": {
        "client_id":     "31dd252f-1ef3-4400-bf78-a2b780d56f63",
        "client_secret": "fbdaa26a-9424-4248-a2b2-a0a6142c27e0",
        "grant_type":    "client_credentials",
        "scope":         "fttx"
    },

    "FLIXFIBRA": {
        "client_id":     "65f6341d-67e5-4668-9a0a-c9358747dc28",
        "client_secret": "7c933cd2-0469-42f5-ae04-71b2320aad20",
        "grant_type":    "client_credentials",
        "scope":         "fttx"
    },

    "HORIZON": {
        "client_id":     "9GzzQ3GsZMkmounDobxpNlzC0dH8sBINnvNRO1H2OwAYTwDO",
        "client_secret": "0tRTvbD8nRZvSpvJ5eu9uJbh1mGodoA6p8zfuO9Dz0wNg6cqfRpf352mRKsknmGY",
        "grant_type":    "client_credentials",
        "scope":         "fttx"
    },

    "HUBSOFT": {
        "client_id":     "b501b2e3-a207-4e8c-8200-cdc66cfbfd87",
        "client_secret": "a467a40e-380f-432d-871a-26d0a370a461",
        "grant_type":    "client_credentials",
        "scope":         "fttx"
    },

    "LIGGA": {
        "client_id":     "058a2452-134d-4818-b30d-f2f2658fca3b",
        "client_secret": "3729e610-9223-49f6-94c5-af8ac6b36166",
        "grant_type":    "client_credentials",
        "scope":         "fttx"
    },

    "LIGGA_SERVICOS": {
        "client_id":     "U71OSpwvihuLD2D1XAXCGAkfO4o8AWxvKs4BpG3qJULEUUsL",
        "client_secret": "V2bD5e9flmie1O6aWyADMKHNfwlityiRshiypD3m9fpV9QBjd2NsN2mVPVYRAbtJ",
        "grant_type":    "client_credentials",
        "scope":         "fttx"
    },

    "LINCAFIBRA": {
        "client_id":     "bef6c333-5f3d-44d4-b652-5def43921e3a",
        "client_secret": "f3bab9f2-447d-49ac-8ca4-ea68bb5023d5",
        "grant_type":    "client_credentials",
        "scope":         "fttx"
    },

    "LOVIZ": {
        "client_id":     "7ba7bc6f-35c9-4fc2-a10e-9b03b77c91ab",
        "client_secret": "1e91affa-9892-4ef1-80e5-1fc34d523581",
        "grant_type":    "client_credentials",
        "scope":         "fttx"
    },

    "MEDIANET_HUBSOFT": {
        "client_id":     "04a17bd8-c2b0-49e8-8d59-71efbdee6d7e",
        "client_secret": "769edb82-465d-459a-881f-ced34f8bfe66",
        "grant_type":    "client_credentials",
        "scope":         "fttx"
    },

    "MELHORPLANO": {
        "client_id":     "srFkAfi2FfKkmXBg7CHB1A7NLqpJe546QhqDdQRUobnCVdUS",
        "client_secret": "yPUNpOOn4XHEZcvysxIVPju6MssvD3P5Azjr5DHiXGGNzC7DnJaaNxFksnKXUFK7",
        "grant_type":    "client_credentials",
        "scope":         "fttx"
    },

    "MIXCONECT_TELECOM": {
        "client_id":     "kxNSMLmJUxYq4eWi0eG7wr1KsKpQxV5QY2Rwt2YeXw3mMoQY",
        "client_secret": "dORpzfyC9IIb7vwxgnhoLRlQeMzbWL5DtjUZvmaoTOuXnIAaxpioq7LxEGB5AztB",
        "grant_type":    "client_credentials",
        "scope":         "fttx"
    },

    "MIXCONET": {
        "client_id":     "VLXrKt0df56BvuSWGRMAztPgbboyJs8KCN3fDeZ9fKRGWqv4",
        "client_secret": "K8zBrAMliNGXWcUdbjeCAQ0y1AvA6PEiFJPchuawGDPGvtLv9QQqTa3SGEDGm1iR",
        "grant_type":    "client_credentials",
        "scope":         "fttx"
    },

    "NIO": {
        "client_id":     "JbbddTNIA33I6nth6jNrHIIvLAAHH6GqAKyEjP2AIe6kS1n1",
        "client_secret": "mYPTMtNvOyIqCESVu0GdaEgW47Z2TZZ9AYcBePSefmXzEcr3IHGzGzlwN6BVKznC",
        "grant_type":    "client_credentials",
        "scope":         "fttx"
    },

    "OBVIOUS": {
        "client_id":     "b91c4fb7-2aa9-4d55-b3c2-74e24772f17c",
        "client_secret": "95bd9348-f6aa-446e-b5b9-764f3dd598f9",
        "grant_type":    "client_credentials",
        "scope":         "fttx"
    },

    "OI_SALESFORCE": {
        "client_id":     "27570445-143f-4829-9cff-9ada6fdfd42a",
        "client_secret": "9ad6aa8c-b5f8-42cd-8c99-4f34e40f49dc",
        "grant_type":    "client_credentials",
        "scope":         "fttx"
    },

    "RBX": {
        "client_id":     "e560cb03-0501-4bc7-9312-97783f1eeac9",
        "client_secret": "2f6d0749-c539-47d2-806b-601ba69f33f0",
        "grant_type":    "client_credentials",
        "scope":         "fttx"
    },

    "SKYFTTP_OTRS": {
        "client_id":     "fe83b040-d956-44da-a49f-f8080fa8146a",
        "client_secret": "9f148dbc-c3b5-42c4-89be-ebe70e04bf4d",
        "grant_type":    "client_credentials",
        "scope":         "fttx"
    },

    "SKYFTTP_ENG_SKYBL": {
        "client_id":     "611b57d3-f0ad-4a7a-af3e-6ea074009aae",
        "client_secret": "57ce5e0c-4198-42eb-83a0-2406d8efae07",
        "grant_type":    "client_credentials",
        "scope":         "fttx"
    },

    "SKYFTTP_CORE": {
        "client_id":     "e40eff3e-0a2f-440b-a787-c18adad3209b",
        "client_secret": "5b23e210-9df1-4a72-afa3-0ddee73ff1b1",
        "grant_type":    "client_credentials",
        "scope":         "fttx"
    },

    "STT": {
        "client_id":     "9b78cd1e-d747-4b90-9d59-858d9a840de7",
        "client_secret": "4afb762c-3b45-4a08-bdbd-67f324778f07",
        "grant_type":    "client_credentials",
        "scope":         "fttx"
    },

    "TESTES_CC9999_CLARO": {
        "client_id":     "2fee9892-0223-43c4-85fe-6e4675d79563",
        "client_secret": "adb2a20d-e06e-4d38-9d05-2bf8c8ee41ab",
        "grant_type":    "client_credentials",
        "scope":         "fttx"
    },

    "TESTES_EQUATORIAL_TRG": {
        "client_id":     "e160f920-e73e-419a-8330-9e5c1b4e59ea",
        "client_secret": "996ceb37-5a4a-4559-afcf-7a6555e2d3f4",
        "grant_type":    "client_credentials",
        "scope":         "fttx"
    },

    "TESTES_IBM_TRGIBM": {
        "client_id":     "d8a88fda-db56-4143-ac3f-e6796aa30186",
        "client_secret": "802d2aa9-8422-4a22-a144-3adfcf061f63",
        "grant_type":    "client_credentials",
        "scope":         "fttx"
    },

    "TESTES_IBM_TRGIBMTIMBIT": {
        "client_id":     "44437e20-2ac6-4c67-9673-a320267fc6a7",
        "client_secret": "153fdbe8-7135-42b4-9049-280366b8056a",
        "grant_type":    "client_credentials",
        "scope":         "fttx"
    },

    "TESTES_OI_TRG": {
        "client_id":     "7f4d2b66-cd0e-4bf6-85fe-46b8b16f1850",
        "client_secret": "446cf1ec-6e80-4ff1-875e-9a9271432ef7",
        "grant_type":    "client_credentials",
        "scope":         "fttx"
    },

    "TESTES_TIM_BITSTREAM_TRG": {
        "client_id":     "ef3b492b-94c3-43e4-bcd6-bc5d1b90e135",
        "client_secret": "f30957b3-e5c0-4b1b-8e6d-22a35c0ec179",
        "grant_type":    "client_credentials",
        "scope":         "fttx"
    },

    "TESTES_VOALLE": {
        "client_id":     "88eab197-1e5f-47db-9d2c-e52dc6c8e497",
        "client_secret": "4458cc78-84bf-4fef-a38c-503c61ee12f5",
        "grant_type":    "client_credentials",
        "scope":         "fttx"
    },

    "TESTES_PS_FTTH": {
        "client_id":     "34ae61fa-5afa-42eb-b763-b93bf2439ee0",
        "client_secret": "15d01649-3686-4f1f-a304-d68890d14144",
        "grant_type":    "client_credentials",
        "scope":         "fttx"
    },

    "TESTES_PS_FTTP": {
        "client_id":     "f9a4d063-4fdf-41f9-b1d3-14914e75f46d",
        "client_secret": "093aba1e-cd5f-4ef2-9fe4-a98e47c26c37",
        "grant_type":    "client_credentials",
        "scope":         "fttx"
    },

    "TEXNET_FTTH": {
        "client_id":     "da5c5814-6419-4f18-ac96-ac744efdbbb1",
        "client_secret": "797be718-059a-4e5a-bd61-c2c2278fe36c",
        "grant_type":    "client_credentials",
        "scope":         "fttx"
    },

    "TEXNET_FTTP": {
        "client_id":     "de849bda-91a2-46fa-994f-22aa23b6cceb",
        "client_secret": "606976b9-06ee-41b7-9da9-8c9d591131c2",
        "grant_type":    "client_credentials",
        "scope":         "fttx"
    },

    "TIM_WL": {
        "client_id":     "49b5eb70-2aac-455f-a0ec-0f6c023c60b4",
        "client_secret": "00dd69e7-ed11-44ca-810e-1b1df163e658",
        "grant_type":    "client_credentials",
        "scope":         "fttx"
    },

    "VERO": {
        "client_id":     "11a5c497-f52b-49fb-8a7b-3ae3e7716c1d",
        "client_secret": "2878db33-396e-45b0-83bd-38f946ecb277",
        "grant_type":    "client_credentials",
        "scope":         "fttx"
    },

    "WIPI_FTTH": {
        "client_id":     "89b0a4bf-c300-473c-a8e4-644951d6046b",
        "client_secret": "fe5dfa3c-f3d2-4190-8023-815a0d2bd6af",
        "grant_type":    "client_credentials",
        "scope":         "fttx"
    }

};

module.exports = { CLIENTS };